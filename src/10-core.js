// ┌─ src/10-core.js ─────────────────────────────────────────────────────
// │ Config, state, el() builder, roles & permissions, auth/session, data loading, formatting helpers.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────

// RIDD Sales Platform — single-file-app controller
// ──────────────────────────────────────────────────────────────────────────
// Module imports via CDN (no bundler, no install)
// VENDORED (Jul 30 2026): supabase-js is bundled INTO the repo. The old
// esm.sh CDN import took the whole app down whenever esm.sh stuttered —
// a hung import = module never evaluates = splash screen forever. Built
// with: esbuild @supabase/supabase-js@2.45.4 --bundle --format=esm --minify.
import { createClient } from './vendor-supabase.js';

const CFG = window.RIDD_CONFIG;
const hasConfig = CFG.SUPABASE_PUBLISHABLE_KEY && !CFG.SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
const DEMO = new URLSearchParams(location.search).has('demo') || location.hash === '#demo';
const _sbReal = hasConfig
  ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// ── SANDBOX MODE (admin) ──────────────────────────────────────────────────
// Born from a real incident: rep counts were being edited live while
// partners had the app open and watched the numbers move. Sandbox lets an
// admin work against LIVE data while every write is intercepted client-side
// and dropped — changes render locally (in-memory state updates as normal)
// but never reach Supabase, so nobody else sees a thing. Session-scoped:
// refresh/exit restores live truth. NOTE: this is a safety catch for the
// admin's own hands, not a security boundary — the JWT stays a real admin.
const SANDBOX_KEY = 'ridd_sandbox_mode';
function sandboxOn() { try { return sessionStorage.getItem(SANDBOX_KEY) === '1'; } catch { return false; } }
function sandboxStart() {
  const real = state._realProfile || state.profile;
  if (!real || !isAdminRole(real.role)) return;
  try { sessionStorage.setItem(SANDBOX_KEY, '1'); } catch { /* private mode */ }
  mountApp();
}
function sandboxExit() {
  try { sessionStorage.removeItem(SANDBOX_KEY); } catch { /* ignore */ }
  // Full reload — the cleanest way to throw away every sandboxed in-memory
  // change and re-pull the live truth.
  location.reload();
}
// Chainable no-op that quacks like a Postgrest builder: any method returns
// itself, awaiting resolves { data: [], error: null } so callers' error
// checks pass and their UI proceeds as if the save landed.
function _sandboxBuilder() {
  const p = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve({ data: [], error: null, count: 0, status: 200, statusText: 'OK (sandbox)' }).then(res, rej);
      if (prop === 'catch') return () => p;
      if (prop === 'finally') return (f) => { try { f && f(); } catch { /* ignore */ } return p; };
      if (prop === Symbol.toStringTag) return 'SandboxBuilder';
      return () => p;
    },
    apply() { return p; },
  });
  return p;
}
const _SANDBOX_TABLE_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
const _SANDBOX_STORAGE_WRITES = new Set(['upload', 'update', 'uploadToSignedUrl', 'remove', 'move', 'copy', 'createSignedUploadUrl']);
const supabase = _sbReal && new Proxy(_sbReal, {
  get(t, prop) {
    if (prop === 'from') return (table) => {
      const qb = t.from(table);
      if (!sandboxOn()) return qb;
      return new Proxy(qb, {
        get(qt, m) {
          if (_SANDBOX_TABLE_WRITES.has(m)) return () => _sandboxBuilder();
          const v = qt[m];
          return typeof v === 'function' ? v.bind(qt) : v;
        },
      });
    };
    if (prop === 'rpc') return (...args) => sandboxOn() ? _sandboxBuilder() : t.rpc(...args);
    if (prop === 'storage') {
      const st = t.storage;
      if (!sandboxOn()) return st;
      return new Proxy(st, {
        get(stt, sp) {
          if (sp === 'from') return (bucket) => {
            const b = stt.from(bucket);
            return new Proxy(b, {
              get(bt, m) {
                if (_SANDBOX_STORAGE_WRITES.has(m)) return async () => ({ data: { path: 'sandbox' }, error: null });
                const v = bt[m];
                return typeof v === 'function' ? v.bind(bt) : v;
              },
            });
          };
          const v = stt[sp];
          return typeof v === 'function' ? v.bind(stt) : v;
        },
      });
    }
    const v = t[prop];
    return typeof v === 'function' ? v.bind(t) : v;
  },
});
// Mutating calls to our Netlify functions (password sets, Slack posts,
// manual sync triggers) are writes too — sandbox swallows them with a fake
// 200. GETs (sync status, spend, version) pass through; the client-error
// logger stays live so sandbox crashes still reach us.
{
  const _realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    try {
      const u = String(url || '');
      const method = String((opts && opts.method) || 'GET').toUpperCase();
      if (sandboxOn() && method !== 'GET' && /^\/(api|\.netlify)\//.test(u) && !u.startsWith('/api/client-error')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, sandbox: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
    } catch { /* fall through to the real fetch */ }
    return _realFetch(url, opts);
  };
}

// Resolve the URL we should bake into Supabase auth emails (invites,
// password resets). When the admin happens to be on localhost the
// browser's origin is unreachable for the rep receiving the email, so
// fall back to the configured production URL. In production we just use
// the current origin — keeps preview deploys self-contained.
function authEmailRedirectUrl() {
  const here = window.location.origin || '';
  const isLocal = here.startsWith('http://localhost') || here.startsWith('http://127.0.0.1');
  if (isLocal && CFG.PUBLIC_URL) return CFG.PUBLIC_URL;
  return here;
}

// Bridge to the admin-set-password Netlify Function. Updating ANOTHER
// user's password requires the Supabase service-role key, which can't
// safely live in the browser — so the function holds it and verifies
// the caller's session JWT belongs to an admin before doing anything.
// Throws on any non-2xx so the call-site's try/catch surfaces the
// error as a toast.
async function callAdminSetPassword(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) throw new Error('Not signed in — cannot set a password');
  const res = await fetch('/api/admin-set-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  'Bearer ' + jwt,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || ('admin-set-password returned ' + res.status));
    err.body = body;   // structured fields (e.g. existing_user_id on a 409) ride along
    throw err;
  }
  return body;
}


// ═══ PERMISSIONS MATRIX (per Isaac) — what each USER TYPE can see. ═══
// Admins always see everything. Defaults mirror shipped behavior exactly;
// overrides are edited in Settings → Permissions (checkbox matrix) and ride
// the synced config row (competitions.extras.perms), so a change reaches
// every user on every device — no deploy per role tweak.
const PERM_ROLES = ['rep_sales', 'rep_partner', 'rep_team_lead', 'rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'auditor'];
const PERM_DEFS = [
  { id: 'view_comps',       label: 'Competitions tab',    group: 'Tabs' },
  { id: 'view_indicators',  label: 'Indicators tab',      group: 'Tabs' },
  { id: 'ind_card',         label: 'My Player Card',      group: 'Indicators sections' },
  { id: 'ind_table',        label: 'Indicators table',    group: 'Indicators sections' },
  { id: 'ind_power_chart',  label: 'Power Ranking chart', group: 'Indicators sections' },
  { id: 'ind_board',        label: 'Leaderboard',         group: 'Indicators sections' },
  { id: 'ind_yoy',          label: 'Performance Trends',  group: 'Indicators sections' },
  { id: 'ind_trend',        label: 'Metric Trends',       group: 'Indicators sections' },
  { id: 'ind_records',      label: 'Records',       group: 'Indicators sections' },
  { id: 'ind_class',        label: 'Class Metrics', group: 'Indicators sections' },
  { id: 'ind_mix',          label: 'Sales Mix table', group: 'Indicators sections' },
];
const PERM_DEFAULTS = {
  rep_sales:       { view_comps: 1, view_indicators: 1, ind_card: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1 },   // no Indicators table / Power Ranking for sales reps (per Isaac, Sep 2026)
  rep_office:      { view_comps: 1, view_indicators: 1, ind_card: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1 },
  rep_loyalty:     { view_comps: 1, view_indicators: 1, ind_card: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1 },
  rep_partner:     { view_comps: 1, view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1 },
  rep_team_lead:   { view_comps: 1, view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1 },
  rep_office_lead: { view_comps: 1, view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1 },
  rep_loyalty_lead: { view_comps: 1, view_indicators: 1, ind_card: 1, ind_table: 1, ind_power_chart: 1, ind_board: 1, ind_yoy: 1, ind_trend: 1, ind_records: 1, ind_class: 1, ind_mix: 1 },
  auditor:         {},   // auditors live in the Sales queue — grant extras here as needed
};
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
];
const PERM_SCOPE_DEFAULTS = {
  rep_sales:       { drill_scope: 'self' },
  rep_office:      { drill_scope: 'self' },
  rep_loyalty:     { drill_scope: 'self' },
  rep_partner:     { drill_scope: 'team' },
  rep_team_lead:   { drill_scope: 'team' },
  rep_office_lead: { drill_scope: 'dept' },
  rep_loyalty_lead: { drill_scope: 'dept' },
  auditor:         { drill_scope: 'none' },
};
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
  rep_office_lead: 'Office Staff - Team Lead',
  rep_loyalty: 'Office Staff - Loyalty Rep',
  rep_loyalty_lead: 'Office Staff - Loyalty Team Lead',
  admin_rep:  'Admin',   // one "Admin" label (per Isaac) — admin_rep still sells under the hood
  admin:      'Admin',
  auditor:    'Auditor',
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
const isOfficeStaffRole = (r) => r === 'rep_office' || r === 'rep_office_lead' || r === 'rep_loyalty' || r === 'rep_loyalty_lead'
  || (r === 'rep' && /office\s*staff/i.test(state.myRepType || ''));

// ──────────────────────────────────────────────────────────────────────────
// Demo state persistence — keep sales/competitions alive across page reloads
// so you can log a sale → audit → stage → process without losing your work
// every time the code updates. Passing ?demo&reset clears storage.
// ──────────────────────────────────────────────────────────────────────────
const DEMO_STORAGE_KEY = 'ridd-demo-data-v1';
// Indicator CSV state is persisted to its OWN localStorage key so it
// survives a refresh in production (not just demo mode). The whole point
// of uploading a CSV every week is to compare to last week's snapshot —
// dropping it on refresh defeats the feature.
const INDICATORS_STORAGE_KEY          = 'ridd-indicators-v1';            // legacy combined key (read-only fallback)
const INDICATORS_SETTINGS_STORAGE_KEY = 'ridd-indicators-settings-v1';   // small config — teams, exclusions, prefs
const INDICATORS_DATA_STORAGE_KEY     = 'ridd-indicators-data-v1';       // bulk — raw CSV rows, raw sales, snapshots

// Small-payload settings: teams, rep tags, view prefs. Save separately from
// the bulk CSV so a quota failure on the big payload doesn't take team-list
// edits down with it.
const INDICATOR_SETTINGS_FIELDS = [
  '_indicatorRepChart',
  '_indicatorRepTeam',        // legacy flat map — kept so old saves still migrate
  '_indicatorRepTeamByYear',  // per-year team assignments (source of truth)
  // NOTE: _teamYear is intentionally NOT persisted — the app always boots on
  // the current calendar year so a stale saved year can't silently change
  // team grouping app-wide. It's still remembered within a session.
  '_indicatorRepTier',
  '_indicatorRepTierYear',    // year each tier tag was made — powers rookie auto-promotion
  '_indicatorRepTypeBySig',   // rep name-signature → "Sold By Type" from the Customer Report
  '_reportingCancelReasonsSeen', // distinct cancel reasons seen in the reporting CSV (persisted universe)
  '_reportingSourcesSeen',       // distinct lead sources seen in the reporting CSV (persisted universe)
  'indicatorDeletedCustIds',     // customer IDs DELETED in FieldRoutes (orphans in the RevHawk mirror) — excluded app-wide
  '_compPillOrder',              // admin drag-sorted order of the Competitions pills (ids, incl. mystery_box)
  '_compFavoriteMystery',        // ★ default-comp flag for the virtual Mystery Boxes pill
  '_compExtras',                 // per-comp synced extras for VIRTUAL pills (★ default flag, Kobe window, …) — anything not backed by a config row
  // ('_indicatorFilterPresets' retired from the SHARED settings — presets
  // are PER USER now, stored on-device per account. Per Isaac.)
  '_indHiddenMetrics',           // hidden Indicators rows, keyed by Type (all/d2d/office/techs) — per Isaac
  '_indHiddenLbCols',            // hidden Rep Leaderboard columns, keyed by Type — per Isaac
  '_indicatorTeams',
  '_indicatorExcludedTeams',
  '_indicatorRankExclude',    // { branch:[...], teams:[...] } — kept on the board but out of Power Ranking
  '_indicatorCompetitions',
  '_indicatorActiveCompId',
  '_indicatorRemovedDefaults', // built-in comps the admin deleted — don't re-seed them
  '_indicatorTeamColors',
  '_indicatorTrendScope',
  '_indicatorRepActive',
  '_indicatorRepOffice',
  '_indicatorRepIncludeRor',
  '_indicatorRepIncludeOneTime',   // leaderboard cancel filter: count one-time service cancels
  '_indicatorRepIncludeRenewals',  // leaderboard cancel filter: count renewal cancels
  '_repFiltersV2',                 // one-time migration stamp: include-everything defaults
  '_indicatorDismissedDupes',
  '_indicatorRepAlias',
  'indicatorMyExclServiceTerms',   // services dropped from BOTH sides of MY% (default: Sentricon)
  // indicatorsGroupBy + indicatorsRangePreset intentionally NOT persisted — the
  // tab always opens on Branch / All reps / This Year; the toggles change them
  // for the current session only, and a refresh returns to the defaults.
  'indicatorsCustomStart',
  'indicatorsCustomEnd',
  '_indicatorChartDrill',
  'indicatorsUploadedAt',
  'indicatorsFileName',
  '_indicatorRawHeaders',
  // Scorecards tab — template config + per-agent/period scorecard data
  // + the currently-selected period. Small payload, lives in settings
  // (not bulk data) so it can't be hit by the indicator CSV quota.
  '_scorecardTemplate',
  '_scorecardTemplates',   // per-department templates (inside_sales / loyalty)
  '_scorecardData',
  '_scorecardAudits',   // call-audit cache (cloud table call_audits is the record)
  '_scorecardMeetings', // 1:1 meeting log cache (cloud table scorecard_meetings is the record)
  '_scorecardPeriod',
];

// Bulk-payload fields: large arrays uploaded via CSV. These can fail quota.
const INDICATOR_DATA_FIELDS = [
  'indicatorsData',
  '_indicatorRawSales',
  '_indicatorSnapshots',
];

const INDICATOR_PERSIST_FIELDS = [...INDICATOR_SETTINGS_FIELDS, ...INDICATOR_DATA_FIELDS];

// Track quota warnings so the toast doesn't fire on every keystroke.
let _indicatorDataSaveWarned = false;

// Compressed fallback store for the bulk indicator data. The raw-sales array
// outgrew the ~5MB localStorage quota as plain JSON; gzip + base64 is ~8×
// smaller and keeps raw sales (teams mode, dept toggle, exact-day ranges,
// header colors) alive across refreshes.
const INDICATORS_DATA_GZ_KEY = 'ridd-indicators-data-gz-v1';

// ── IndexedDB bulk store ─────────────────────────────────────────────────
// localStorage caps at ~5MB for the whole origin, which an all-time CSV
// blows through even gzipped. IndexedDB has no practical limit, so the full
// bulk payload (raw rows already stripped) is mirrored there on every save
// and restored on load. localStorage remains a fast-paint fallback.
function _indIdbOpen() {
  return new Promise((res, rej) => {
    if (typeof indexedDB === 'undefined') return rej(new Error('IndexedDB unavailable'));
    const rq = indexedDB.open('ridd-indicators', 1);
    rq.onupgradeneeded = () => rq.result.createObjectStore('kv');
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
}
async function _indIdbSet(key, val) {
  const db = await _indIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(val, key);
    tx.oncomplete = () => { db.close(); res(); };
    tx.onerror = () => { db.close(); rej(tx.error); };
  });
}
async function _indIdbGet(key) {
  const db = await _indIdbOpen();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readonly');
    const rq = tx.objectStore('kv').get(key);
    rq.onsuccess = () => { db.close(); res(rq.result); };
    rq.onerror = () => { db.close(); rej(rq.error); };
  });
}

let _indSaveSeq = 0;
async function _storeIndicatorDataCompressed(json) {
  const seq = ++_indSaveSeq;
  try {
    if (typeof CompressionStream === 'undefined') return;
    const blob = await new Response(new Blob([json]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const buf = new Uint8Array(await blob.arrayBuffer());
    let bin = ''; const STEP = 0x8000;
    for (let i = 0; i < buf.length; i += STEP) bin += String.fromCharCode.apply(null, buf.subarray(i, i + STEP));
    const b64 = btoa(bin);
    if (seq !== _indSaveSeq) return; // a newer save superseded this one
    localStorage.setItem(INDICATORS_DATA_GZ_KEY, b64);
    _indicatorDataSaveWarned = false;
  } catch (e) {
    console.warn('[ridd] compressed indicator save failed', e);
    // A gz copy we can no longer overwrite is worse than none: it would keep
    // resurrecting the LAST dataset that fit, shadowing the (unlimited)
    // IndexedDB copy on every boot. Drop it — IDB + cloud carry the data.
    try { localStorage.removeItem(INDICATORS_DATA_GZ_KEY); } catch { /* ignore */ }
  }
}

// ── Shared indicators dataset (Supabase Storage) ─────────────────────────
// localStorage is per-browser, so one admin's upload was invisible to every
// other admin. Each import now also pushes the dataset (gzipped) to the
// shared `reporting` bucket at a fixed path, and the Indicators tab pulls
// the newest copy for whoever is looking — uploads persist across users.
const INDICATORS_CLOUD_PATH = 'indicators/latest.json.gz';
// DATA MINIMIZATION: admins/auditors pull the full dataset; every other
// role pulls the rep-sanitized copy (customer name/id blanked server-side).
// Storage policy (security_rls.sql) enforces this at the database — the
// full blob 403s for rep sessions even if someone edits this code locally.
function _indicatorsCloudPath() {
  const role = state.profile && state.profile?.role;
  return (isAdminRole(role) || isAuditorRole(role)) ? INDICATORS_CLOUD_PATH : 'indicators/latest-rep.json.gz';
}
async function syncIndicatorsToCloud() {
  if (DEMO || typeof CompressionStream === 'undefined') return;
  try {
    const payload = {
      uploadedAt: state.indicatorsUploadedAt,
      fileName:   state.indicatorsFileName || '',
      indicatorsData: state.indicatorsData || [],
      rawSales: (state._indicatorRawSales || []).map(s => {
        if (!s || !s._rawRow) return s;
        const { _rawRow, ...rest } = s; return rest;
      }),
    };
    const blob = await new Response(new Blob([JSON.stringify(payload)]).stream()
      .pipeThrough(new CompressionStream('gzip'))).blob();
    const { error } = await supabase.storage.from('reporting')
      .upload(INDICATORS_CLOUD_PATH, blob, { contentType: 'application/gzip', upsert: true });
    if (error) {
      console.warn('[ridd] indicators cloud sync failed (run reporting_storage.sql?)', error);
      return { ok: false, msg: error.message || String(error) };
    }
    // Rep-facing copy too (rep-UX audit #5): reps read latest-rep.json.gz —
    // without this, an admin-side publish left reps on older numbers until
    // the background worker's next successful run.
    try {
      await supabase.storage.from('reporting')
        .upload('indicators/latest-rep.json.gz', blob, { contentType: 'application/gzip', upsert: true });
    } catch (e2) { console.warn('[ridd] rep blob publish skipped', e2); }
    return { ok: true };
  } catch (e) {
    console.warn('[ridd] indicators cloud sync failed', e);
    return { ok: false, msg: e?.message || String(e) };
  }
}

let _indCloudCheckedAt = 0;
// ── Technician route stats (indicators/tech-stats.json.gz, hourly from
// tech-stats-background): per tech per day — scheduled / completed /
// production / reservices / interior / on-site minutes. Any signed-in user.
let _techStatsCheckedAt = 0;
async function refreshTechStatsFromCloud(force) {
  if (DEMO || !state.profile || typeof DecompressionStream === 'undefined') return;
  if (!force && Date.now() - _techStatsCheckedAt < 300000) return;
  _techStatsCheckedAt = Date.now();
  try {
    const r = await _downloadSnapshotBlob('indicators/tech-stats.json.gz', null, { meta: true }).catch(() => null);
    if (!r || !r.blob) return;
    const text = await new Response(r.blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.rows)) return;
    state.techStats = payload; healthReport('techstats', true);
    if (state.view === 'techs') mountApp();
  } catch (e) { healthReport('techstats', false, e); }
}
async function refreshIndicatorsFromCloud(force) {
  // Open to every signed-in user (was admin-only) — the rep-facing NRLA board
  // reads the same shared dataset. Reads only; config pushes stay admin-gated.
  if (DEMO || !state.profile) return;
  // Manual-data mode pins Indicators to an admin's uploaded CSV (THIS
  // browser only) — the background poll must never overwrite it. Reverting
  // clears the flag first, then calls this with force=true.
  if (state._indManualMode) return;
  if (typeof DecompressionStream === 'undefined') return;
  if (!force && Date.now() - _indCloudCheckedAt < 120000) return; // ≤1 check / 2 min
  _indCloudCheckedAt = Date.now();
  try {
    // Streamed download with stall watchdog + retries (see _downloadSnapshotBlob),
    // and CONDITIONAL: we remember the fingerprint (ETag) of the copy we already
    // have, so when nothing new has landed the server answers 304 with no body.
    // That keeps every open tab's 10-min poll effectively free at any headcount.
    const _cloudPath = _indicatorsCloudPath();
    const TAG_KEY = 'ridd_ind_cloud_tag:' + _cloudPath;
    let prevTag = {};
    try { prevTag = JSON.parse(localStorage.getItem(TAG_KEY) || '{}') || {}; } catch { /* ignore */ }
    let r = await _downloadSnapshotBlob(_cloudPath, null, {
      meta: true,
      ifNoneMatch: prevTag.etag || undefined,
      ifModifiedSince: prevTag.lastModified || undefined,
    }).catch(() => null);
    // REP-BLOB FALLBACK: if the sanitized copy doesn't exist yet (it only
    // publishes on a successful sync run), fall back to the full blob so a
    // fresh device is never data-blind. Storage policy may 403 this for
    // reps once applied — that's fine, the next successful sync creates
    // the rep blob and this path stops firing.
    if ((!r || (!r.blob && !r.notModified)) && _cloudPath !== INDICATORS_CLOUD_PATH) {
      r = await _downloadSnapshotBlob(INDICATORS_CLOUD_PATH, null, { meta: true }).catch(() => null);
    }
    if (r && r.notModified) { state._indPullError = null; healthReport('indicators', true); return; }   // device is reachable + up to date
    if (!r || !r.blob) {
      // 403 / 404 / timeout on THIS DEVICE — the server-age stamp can stay
      // green while this phone shows days-old numbers. Record it so the
      // stamp can say so (cleared on the next successful pull).
      state._indPullError = { at: Date.now(), msg: 'download failed' }; healthReport('indicators', false, 'download failed');
      return; // next poll retries
    }
    const blob = r.blob;
    const text = await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text();
    const payload = JSON.parse(text);
    if (!payload || !Array.isArray(payload.indicatorsData)) return;
    const remoteAt = payload.uploadedAt ? new Date(payload.uploadedAt).getTime() : 0;
    const localAt  = state.indicatorsUploadedAt ? new Date(state.indicatorsUploadedAt).getTime() : 0;
    const _saveTag = () => { try { localStorage.setItem(TAG_KEY, JSON.stringify({ etag: r.etag || null, lastModified: r.lastModified || null })); } catch { /* ignore */ } };
    if (!remoteAt) return;
    if (remoteAt === localAt) { _saveTag(); return; }            // same dataset — remember the tag, skip the work
    // THE SERVER IS THE WRITER now — the RevHawk sync job derives and
    // publishes the shared dataset with every snapshot. The only legitimate
    // way for LOCAL to be ahead is a manual CSV import on an admin device
    // (which shares itself up as it saves). Everything else — including
    // RevHawk-stamped data with a stale or clock-skewed stamp — adopts the
    // server copy on ANY difference. The tag is only saved on apply/match
    // so skips keep re-checking.
    if (remoteAt < localAt
        && isAdminRole(state.profile && state.profile?.role)
        && !/^RevHawk sync/i.test(state.indicatorsFileName || '')) return;
    _saveTag();
    // Branch-name heal at the ONE ingest point (branchAlias: seeded with
    // Office 20 → LITTLE ROCK; future renames ship via config, no deploy).
    try {
      (payload.indicatorsData || []).forEach(r2 => { const a = branchAlias(r2.branch); if (a !== r2.branch) r2.branch = a; });
      (payload.rawSales || []).forEach(s2 => { const a = branchAlias(s2.office); if (a !== s2.office) s2.office = a; });
    } catch (e) { /* cosmetic heal only */ }
    state.indicatorsData       = payload.indicatorsData;
    state._indicatorRawSales   = payload.rawSales || [];
    state.indicatorsUploadedAt = payload.uploadedAt;
    state.indicatorsFileName   = payload.fileName || '';
    state.indicatorsWeek = -1;
    reactivateRecentSellers(); // bring back any Inactive rep who sold again
    try { _applyIndicatorsPayloadHousekeeping(payload); } catch (hkErr) { console.warn('[ridd] payload housekeeping failed', hkErr); }
    saveDemoData();
    // Silent by design: this fires on every open/wake as routine hygiene —
    // the Last-sync stamp is the freshness UI, not a popup.
    state._indPullError = null; healthReport('indicators', true);
    console.info('[ridd] indicators refreshed from cloud (' + (payload.fileName || 'CSV') + ')');
    if (typeof scheduleBackgroundRemount === 'function') scheduleBackgroundRemount(); else mountApp();
    setTimeout(() => { try { maybeShowWeeklyRecap(); } catch { /* ignore */ } }, 800);
  } catch (e) {
    state._indPullError = { at: Date.now(), msg: String((e && e.message) || e || 'network') }; healthReport('indicators', false, e);
    console.warn('[ridd] indicators cloud refresh failed', e);
  }
}

// Post-apply housekeeping — the things the local PARSE path used to do that
// must now happen when a device APPLIES the server-derived payload instead
// (browsers no longer parse snapshots in the normal flow).
function _applyIndicatorsPayloadHousekeeping(payload) {
  const raw = (payload && payload.rawSales) || [];
  // 1. Rep-type sig map from the additive per-sale repType field. Server
  //    payloads carry it (from the CRM's Sold By Type); this gives every
  //    account — including reps, who never load the Reporting tab — the
  //    authoritative department mapping.
  try {
    const m = {};
    for (const s of raw) {
      const t = (s && s.repType || '').trim();
      if (!t || !s.rep) continue;
      const k = _repTypeNameSig(typeof getCanonicalRepName === 'function' ? getCanonicalRepName(s.rep) : s.rep);
      if (k && !m[k]) m[k] = t;
    }
    if (Object.keys(m).length) {
      state._indicatorRepTypeBySig = Object.assign({}, state._indicatorRepTypeBySig || {}, m);
    }
  } catch (e) { console.warn('[ridd] rep-type map from payload failed', e); }
  // 2. Rep → office auto-sync (admins only — it lands in shared config).
  try {
    if (!isAdminRole(state.profile && state.profile?.role)) return;
    const counts = {};
    for (const s of raw) {
      if (!s || !s.rep || !s.office) continue;
      (counts[s.rep] = counts[s.rep] || {})[s.office] = (counts[s.rep][s.office] || 0) + 1;
    }
    if (!state._indicatorRepOffice) state._indicatorRepOffice = {};
    let updated = 0;
    for (const [rep, c] of Object.entries(counts)) {
      const top = Object.entries(c).sort((a, b) => b[1] - a[1])[0]?.[0];
      if (top && state._indicatorRepOffice[rep] !== top) { state._indicatorRepOffice[rep] = top; updated++; }
    }
    if (updated > 0) {
      if (typeof _invalidateRepSigIndex === 'function') _invalidateRepSigIndex(state._indicatorRepOffice);
      if (typeof saveIndicatorState === 'function') saveIndicatorState();
    }
  } catch (e) { console.warn('[ridd] rep-office merge from payload failed', e); }
}

// Refs of the bulk data last persisted, so config-only saves (team/tier
// assignments etc.) can skip re-serializing the whole raw-sales array.
let _lastBulkRawRef = null, _lastBulkDataRef = null, _lastBulkSnapCount = -1;
function saveIndicatorState() {
  // Any settings save may change exclusions/teams — drop the sales caches.
  if (typeof _indCfgRev !== 'undefined') _indCfgRev++;
  // COMPANY-NUMBER rules mirror into the synced extras (their UI already
  // claimed "for every user" — now it's true): deleted-account exclusions +
  // the Rep Leaderboard cancel-count toggles.
  try {
    state._compExtras = state._compExtras || {};
    const _ar = state._compExtras.adminRules = state._compExtras.adminRules || {};
    if (Array.isArray(state.indicatorDeletedCustIds)) _ar.deletedCustIds = state.indicatorDeletedCustIds;
    if (typeof state._indicatorRepIncludeRor === 'boolean') _ar.repIncludeRor = state._indicatorRepIncludeRor;
    if (typeof state._indicatorRepIncludeOneTime === 'boolean') _ar.repIncludeOneTime = state._indicatorRepIncludeOneTime;
    if (typeof state._indicatorRepIncludeRenewals === 'boolean') _ar.repIncludeRenewals = state._indicatorRepIncludeRenewals;
  } catch (e) { /* mirror is best-effort */ }
  // Settings ALWAYS save first, with their own try/catch, so a quota failure
  // on the bulk CSV save can't roll back team/rep edits. Without this split,
  // adding a team while the data payload was over quota silently dropped the
  // team on the next refresh.
  try {
    const settings = { savedAt: new Date().toISOString() };
    for (const k of INDICATOR_SETTINGS_FIELDS) settings[k] = state[k];
    localStorage.setItem(INDICATORS_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    // Remember when THIS browser last saved settings — the server-config load
    // uses it to refuse to clobber newer local work with a stale server row.
    state._indicatorSettingsSavedAt = settings.savedAt;
  } catch (err) {
    console.warn('[ridd] failed to save indicator settings', err);
    if (typeof toast === 'function') toast('Could not save team/rep settings — localStorage may be full', 'error');
  }
  // Settings also mirror up to Supabase (production only) so any admin on
  // any device sees the same teams/tiers/rep overrides. Fire-and-forget —
  // localStorage already has the fresh value, so the UI doesn't wait on
  // the round-trip and a network failure doesn't roll back the local save.
  saveIndicatorConfigToSupabase().catch(err => console.warn('[ridd] indicator config sync failed', err));
  // Bulk-data persist is expensive — it serializes the entire raw-sales array
  // (100k+ rows on a year upload). Config edits (team/tier/office assignments,
  // exclusions, colors) only change SETTINGS, which are already saved above, so
  // skip the bulk block unless the underlying data actually changed. Detect by
  // reference (indicatorsData + _indicatorRawSales are rebuilt on every
  // upload/sync) plus snapshot count (snapshots are pushed in place).
  const _snapCount = Array.isArray(state._indicatorSnapshots) ? state._indicatorSnapshots.length : 0;
  const _bulkUnchanged = state._indicatorRawSales === _lastBulkRawRef
    && state.indicatorsData === _lastBulkDataRef
    && _snapCount === _lastBulkSnapCount;
  if (!_bulkUnchanged) {
  try {
    const data = { savedAt: new Date().toISOString() };
    // Stamp the upload time on the bulk payload so the IndexedDB restore
    // can tell whether its copy is older than what's already in state
    // (e.g. a fresher upload just pulled from the cloud).
    data.indicatorsUploadedAt = state.indicatorsUploadedAt;
    for (const k of INDICATOR_DATA_FIELDS) {
      if (k === '_indicatorRawSales' && Array.isArray(state[k])) {
        // Strip _rawRow from each sale before persisting. It's a full
        // copy of the original CSV row (~30 columns × ~20 chars each)
        // attached to every sale, so on a year-sized upload it can
        // roughly double the localStorage footprint and trip the
        // browser's ~5MB quota. The in-memory state keeps _rawRow for
        // the current session so the raffle + Top-5 exports still get
        // the full passthrough; on a refresh the exports fall back to
        // their known-column path (both already guard with
        // `Array.isArray(s._rawRow)`), and a re-upload restores the
        // raw rows.
        data[k] = state[k].map(s => {
          if (!s || !s._rawRow) return s;
          const { _rawRow, ...rest } = s;
          return rest;
        });
      } else {
        data[k] = state[k];
      }
    }
    // Snapshot history grows with every import — keep only the last few
    // locally so it can't crowd the raw sales out of the quota.
    if (Array.isArray(data._indicatorSnapshots) && data._indicatorSnapshots.length > 6) {
      data._indicatorSnapshots = data._indicatorSnapshots.slice(-6);
    }
    // IndexedDB is THE bulk store (no quota). The old localStorage paths
    // (plain JSON → gz fallback → slim-without-rows fallback) are retired:
    // the dataset outgrew the 5MB quota on desktops too, and each fallback
    // was another way for a device to resurrect stale data or hold a fresh
    // stamp with no rows. One store, one truth. The legacy localStorage
    // bulk keys are actively removed so an old copy can never shadow IDB.
    _indIdbSet('bulk', data).catch(e => {
      // IDB unavailable (rare: private mode on some browsers) — fall back to
      // the compressed localStorage path, which self-deletes when stale.
      console.warn('[ridd] IndexedDB indicator save failed — using gz fallback', e);
      try { _storeIndicatorDataCompressed(JSON.stringify(data)); } catch { /* memory-only session */ }
    });
    try {
      localStorage.removeItem(INDICATORS_DATA_STORAGE_KEY);
      localStorage.removeItem(INDICATORS_DATA_GZ_KEY);
    } catch { /* ignore */ }
  } catch (err) {
    console.warn('[ridd] indicator bulk save failed', err);
  }
  // Remember what we just persisted so subsequent config-only saves skip this
  // block until the underlying data changes again.
  _lastBulkRawRef = state._indicatorRawSales;
  _lastBulkDataRef = state.indicatorsData;
  _lastBulkSnapCount = _snapCount;
  }
}

// ── Coalesced background re-render ──────────────────────────────────────
// The async boot loaders (settings, company goal, gz cache, IndexedDB bulk
// restore) each used to trigger their OWN full re-render as they resolved —
// four+ complete DOM rebuilds before the user touched anything, a big part
// of why refreshes felt slow. Requests within a short window now collapse
// into a single re-render, and it stays out of the way while the main
// loading sequence is still in flight (it re-renders at the end anyway).
let _bgRemountTimer = null;
// RENDER STABILITY — background repaints wait for a QUIET moment: if the
// user scrolled / tapped / typed in the last ~1.2s the remount re-arms and
// tries again shortly, so fresh data can never yank the page mid-read.
// (Direct user actions still call mountApp() synchronously as always.)
let _lastMountedView = null;
let _lastUserActivity = 0;
if (typeof window !== 'undefined' && !window._riddActivityWired) {
  window._riddActivityWired = true;
  const _act = () => { _lastUserActivity = Date.now(); };
  ['scroll', 'wheel', 'pointerdown', 'touchmove', 'keydown'].forEach(ev => window.addEventListener(ev, _act, { passive: true }));
}
function scheduleBackgroundRemount() {
  if (_bgRemountTimer) return;
  const attempt = (tries) => {
    _bgRemountTimer = null;
    if (!state.profile || typeof mountApp !== 'function' || _loadAndRenderInFlight) return;
    if (Date.now() - _lastUserActivity < 1200 && tries < 8) {
      _bgRemountTimer = setTimeout(() => attempt(tries + 1), 700);
      return;
    }
    mountApp();
  };
  _bgRemountTimer = setTimeout(() => attempt(0), 120);
}
// Healed "Last upload" stamp for page headers. Self-repairs a stored
// timestamp that lags the dataset label (partial state restores), and never
// exposes the dataset's internal filename — just the time.
function indicatorsSyncStampText() {
  if (!state.indicatorsUploadedAt) return '';
  let t = new Date(state.indicatorsUploadedAt);
  const m = /RevHawk sync — (\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(state.indicatorsFileName || '');
  if (m) {
    const labelDay = new Date(+m[3], +m[1] - 1, +m[2]);
    if (isNaN(t) || t < labelDay) {
      const up0 = (state.reportingUploads || [])[0];
      const upT = up0 && up0.uploaded_at ? new Date(up0.uploaded_at) : null;
      t = (upT && upT >= labelDay) ? upT : labelDay;
      state.indicatorsUploadedAt = t.toISOString();
    }
  }
  if (isNaN(t)) return '';
  return t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
// ONE sync clock, app-wide (per Isaac). Every stamp shows the SAME
// timestamp (the shared dataset's publish moment) in the SAME zone — the
// user's Time Zone preference, defaulting to Mountain (company clock) —
// with the zone label printed so two users comparing screens can never
// think they're out of sync when they're just in different time zones.
// ONE description of where the numbers come from and how fresh they are
// (provenance audit): every tooltip that talks about the sync quotes this.
const SYNC_CADENCE_TEXT = 'FieldRoutes data reaches the app through the RevHawk mirror, which refreshes once a night (~2 AM MT). The app re-syncs from that mirror every hour during selling hours (8 AM–11 PM ET), so boards, Indicators and Reporting show CRM data as of the last nightly mirror; the Sales queues also pick up same-day accounts from a 15-minute FieldRoutes live pull when it is enabled.';
function appSyncStampStr() {
  indicatorsSyncStampText();   // runs the self-heal on the stored timestamp
  if (!state.indicatorsUploadedAt) return '';
  const t = new Date(state.indicatorsUploadedAt);
  if (isNaN(t)) return '';
  const p = (typeof userTzPref === 'function') ? userTzPref() : 'auto';
  const tz = (typeof _TZ_RAW_OFFSET !== 'undefined' && _TZ_RAW_OFFSET[p] != null) ? p : 'America/Denver';
  try {
    return t.toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).replace(',', ' \u00b7');
  } catch (e) {
    return t.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  }
}
// Is the shared dataset OVERDUE? Syncs land hourly on the hour, 8am–11pm ET
// (paused overnight). Data older than ~100 min DURING selling hours means a
// run failed or hasn't landed — the header stamp turns amber so staleness
// is visible instead of silently trusted.
function indicatorsSyncOverdue() {
  return indicatorsSyncStaleness() !== null;
}
// Two-tier staleness: 'amber' (>100 min — one run missed) escalates to
// 'red' (>4 h — multiple consecutive failures, someone should look NOW).
function indicatorsSyncStaleness() {
  if (!state.indicatorsUploadedAt) return null;
  const t = new Date(state.indicatorsUploadedAt);
  if (isNaN(t)) return null;
  const nowET = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const h = nowET.getHours();
  if (h < 8 || h >= 23) return null;                           // overnight pause — big gaps are normal
  if (h === 8 && nowET.getMinutes() < 15) return null;         // give the 8:00 run time to land
  const age = Date.now() - t.getTime();
  if (age > 4 * 60 * 60 * 1000) return 'red';
  if (age > 100 * 60 * 1000) return 'amber';
  return null;
}

function loadIndicatorState() {
  // Read the new split keys first; fall back to the legacy combined key if a
  // user is loading from a state written before the split.
  const applyObj = (parsed) => {
    if (!parsed) return;
    for (const k of INDICATOR_PERSIST_FIELDS) {
      if (parsed[k] !== undefined) state[k] = parsed[k];
    }
  };
  const apply = (raw) => {
    if (!raw) return;
    try { applyObj(JSON.parse(raw)); }
    catch (err) { console.warn('[ridd] failed to parse indicator state', err); }
  };
  // Legacy combined key: only parse it when the split keys don't exist yet
  // (first boot after upgrading). It can be several MB and JSON.parse is
  // synchronous — skipping it when it's redundant shaves real time off every
  // refresh, since the split keys below override all its fields anyway.
  if (!localStorage.getItem(INDICATORS_DATA_STORAGE_KEY) && !localStorage.getItem(INDICATORS_SETTINGS_STORAGE_KEY)) {
    apply(localStorage.getItem(INDICATORS_STORAGE_KEY));      // legacy combined
  }
  apply(localStorage.getItem(INDICATORS_DATA_STORAGE_KEY));   // bulk (overrides legacy data fields)
  apply(localStorage.getItem(INDICATORS_SETTINGS_STORAGE_KEY)); // settings (overrides legacy settings fields)
  // Capture the settings save-stamp for the stale-server guard below.
  try { state._indicatorSettingsSavedAt = (JSON.parse(localStorage.getItem(INDICATORS_SETTINGS_STORAGE_KEY) || 'null') || {}).savedAt || ''; }
  catch { state._indicatorSettingsSavedAt = ''; }
  if (typeof _normalizeRepKeyedMaps === 'function') _normalizeRepKeyedMaps();
  if (typeof _hydrateTeamYears === 'function') _hydrateTeamYears();

  // Compressed bulk cache (written when plain JSON exceeded the quota).
  // Decompression is async, so the page may paint once without raw sales
  // and re-mount the moment they're back.
  const gz = localStorage.getItem(INDICATORS_DATA_GZ_KEY);
  if (gz && typeof DecompressionStream !== 'undefined') {
    (async () => {
      try {
        const bin = atob(gz);
        const buf = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const text = await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).text();
        // FRESHNESS GUARD — this async path used to apply unconditionally,
        // racing (and losing to) the IndexedDB restore and the cloud pull.
        // A gz copy that can no longer be refreshed (writes fail once the
        // dataset outgrows the quota) would resurrect month-old data on
        // every boot. Only apply when it's NOT older than what we hold;
        // when it IS older, delete it so it can't shadow IndexedDB again.
        let parsed = null;
        try { parsed = JSON.parse(text); } catch { /* handled below */ }
        const _curUp = state.indicatorsUploadedAt ? Date.parse(state.indicatorsUploadedAt) : 0;
        const _gzUp  = parsed && parsed.indicatorsUploadedAt ? Date.parse(parsed.indicatorsUploadedAt) : 0;
        const _haveRaw = Array.isArray(state._indicatorRawSales) && state._indicatorRawSales.length > 0;
        if (parsed && _haveRaw && _curUp && _gzUp && _gzUp < _curUp) {
          console.warn('[ridd] stale compressed indicator cache (' + parsed.indicatorsUploadedAt + ') — dropping it; IndexedDB/cloud copy wins');
          try { localStorage.removeItem(INDICATORS_DATA_GZ_KEY); } catch { /* ignore */ }
        } else if (parsed) {
          applyObj(parsed);
          scheduleBackgroundRemount();
        }
      } catch (e) {
        console.warn('[ridd] compressed indicator cache unreadable', e);
      }
    })();
  }

  // IndexedDB bulk restore — the primary store for all-time-sized uploads
  // that don't fit in localStorage at all. Applied when it's at least as
  // fresh as whatever the localStorage path produced (same save writes both,
  // so equal timestamps mean the idb copy has the full raw-sales array).
  // COHERENCE GUARD — the freshness stamp must describe data we actually
  // HOLD. The stamp persists in the small settings key (always saves) while
  // raw sales live in the big bulk key (can fail quota on phones and fall
  // back to a slim copy WITHOUT rows). On the next boot that fresh-stamp/
  // no-data combo made the cloud refresh think this device was current and
  // skip the fix — the "month-old board with no numbers" bug. No rows → no
  // freshness claim; the cloud copy then applies unconditionally.
  if (state.indicatorsUploadedAt && !(Array.isArray(state._indicatorRawSales) && state._indicatorRawSales.length)) {
    state.indicatorsUploadedAt = null;
  }
  const lsBulkAt = (() => {
    try { return (JSON.parse(localStorage.getItem(INDICATORS_DATA_STORAGE_KEY) || 'null') || {}).savedAt || ''; }
    catch { return ''; }
  })();
  (async () => {
    try {
      const bulk = await _indIdbGet('bulk');
      if (!bulk || !bulk.savedAt) return;
      // Never clobber fresher data that landed while we were reading —
      // the cloud refresh may have already pulled a newer admin's upload.
      const curUp  = state.indicatorsUploadedAt ? Date.parse(state.indicatorsUploadedAt) : 0;
      const bulkUp = bulk.indicatorsUploadedAt ? Date.parse(bulk.indicatorsUploadedAt) : 0;
      if (curUp && bulkUp && bulkUp < curUp) return;
      const haveRaw = Array.isArray(state._indicatorRawSales) && state._indicatorRawSales.length > 0;
      if (bulk.savedAt >= lsBulkAt || !haveRaw) {
        applyObj(bulk);
        scheduleBackgroundRemount();
      }
    } catch (e) { console.warn('[ridd] IndexedDB indicator restore failed', e); }
  })();
}

// ── Supabase-backed indicator config (teams, tiers, rep overrides) ──────
// localStorage worked but was per-browser, per-device — admins re-doing the
// setup every refresh / new machine / cleared cache. This pair pushes the
// same fields up to public.indicator_config (single row, RLS: admin write)
// so any admin on any device sees the same teams.
// Demo mode keeps the localStorage path only — no Supabase round-trip,
// no auth state to lean on.
async function loadIndicatorConfigFromSupabase() {
  if (DEMO || !state.profile) return;
  try {
    const { data, error } = await supabase
      .from('indicator_config').select('*').eq('id', 1).maybeSingle();
    if (error) { console.warn('[ridd] indicator_config select failed', error); return; }
    // Server is the source of truth in production. Empty arrays / objects
    // from the server intentionally overwrite local values so a "reset"
    // from another admin shows up here too.
    const hasServerData = data && (
      (Array.isArray(data.teams) && data.teams.length > 0) ||
      Object.keys(data.rep_teams || {}).length > 0 ||
      Object.keys(data.rep_tiers || {}).length > 0
    );
    // UNSYNCED-EDITS GUARD — if this browser has config edits that never made
    // it to the server (content differs from the last synced fingerprint),
    // applying the server copy would wipe them. Keep local, push it up.
    // A clean browser always adopts the server copy.
    //
    // STALE-DEVICE ESCAPE HATCH: only keep-local-and-push when our edits were
    // made against the CURRENT server copy. If the server has moved past this
    // browser's baseline, "local edits" are edits to an outdated config —
    // pushing them would clobber newer work from other admins (this exact
    // failure mode showed up as an admin stuck seeing only one competition).
    // Server wins the conflict; the toast tells the admin what happened.
    if (hasServerData && _indCfgDirty() && isAdminRole(state.profile?.role)) {
      const _rec = _indCfgSyncRec();
      const _serverAt = data.updated_at ? new Date(data.updated_at).getTime() : 0;
      const _baseAt = _rec && _rec.serverAt ? new Date(_rec.serverAt).getTime() : 0;
      if (!_serverAt || _serverAt <= _baseAt + 1000) {
        console.warn('[ridd] unsynced local indicator config — pushing local up instead of applying server');
        saveIndicatorConfigToSupabase().catch(err => console.warn('[ridd] config push-up failed', err));
        return;
      }
      console.warn('[ridd] server config is NEWER than this browser\'s baseline — adopting server copy (stale local edits discarded)');
      // fall through: apply the server copy below
    }
    if (hasServerData) {
      state._indicatorTeams         = Array.isArray(data.teams) ? data.teams : (state._indicatorTeams || []);
      state._indicatorTeamColors    = data.team_colors   && typeof data.team_colors   === 'object' ? data.team_colors   : (state._indicatorTeamColors || {});
      state._indicatorTeamLogos     = data.team_logos    && typeof data.team_logos    === 'object' ? data.team_logos    : (state._indicatorTeamLogos || {});
      state._indicatorExcludedTeams = Array.isArray(data.team_excluded) ? data.team_excluded : (state._indicatorExcludedTeams || []);
      if (data.competitions && typeof data.competitions === 'object') {
        if (Array.isArray(data.competitions.list)) state._indicatorCompetitions = data.competitions.list;
        if (data.competitions.active)              state._indicatorActiveCompId = data.competitions.active;
        if (Array.isArray(data.competitions.removed)) state._indicatorRemovedDefaults = data.competitions.removed;
        // Power-Ranking exclusions ride in this jsonb too — they used to be
        // per-browser only, so a Salt Lake excluded on desktop still ranked
        // on the admin's phone.
        if (data.competitions.rankExclude && typeof data.competitions.rankExclude === 'object') state._indicatorRankExclude = data.competitions.rankExclude;
        // Rep aliases (duplicate merges) + dismissed dupe pairs sync too —
        // a merge is data correctness, not a view preference: per-browser
        // aliases meant leaderboard totals differed between admin devices.
        if (data.competitions.repAlias && typeof data.competitions.repAlias === 'object') state._indicatorRepAlias = data.competitions.repAlias;
        // Virtual-comp config rides the same row (per Isaac's rep-UX audit):
        // ISL divisions/history, Kobe window + freeze, KOTH freeze, ★
        // default and pill order now reach EVERY user, not just the admin
        // device that wrote them.
        if (data.competitions.extras && typeof data.competitions.extras === 'object') state._compExtras = data.competitions.extras;
        // Hydrate the synced admin rules back into their state fields so
        // every consumer (leaderboard toggles, deleted-ID exclusions) sees
        // the SHARED values, not this device's leftovers.
        try {
          const _ar = state._compExtras && state._compExtras.adminRules;
          if (_ar) {
            if (Array.isArray(_ar.deletedCustIds)) state.indicatorDeletedCustIds = _ar.deletedCustIds;
            if (typeof _ar.repIncludeRor === 'boolean') state._indicatorRepIncludeRor = _ar.repIncludeRor;
            if (typeof _ar.repIncludeOneTime === 'boolean') state._indicatorRepIncludeOneTime = _ar.repIncludeOneTime;
            if (typeof _ar.repIncludeRenewals === 'boolean') state._indicatorRepIncludeRenewals = _ar.repIncludeRenewals;
          }
        } catch (e) { /* fallback: local values */ }
        if (Array.isArray(data.competitions.pillOrder)) state._compPillOrder = data.competitions.pillOrder;
        if (typeof data.competitions.favMystery === 'boolean') state._compFavoriteMystery = data.competitions.favMystery;
        if (Array.isArray(data.competitions.dupesDismissed)) state._indicatorDismissedDupes = data.competitions.dupesDismissed;
        if (data.competitions.tierYears && typeof data.competitions.tierYears === 'object') state._indicatorRepTierYear = data.competitions.tierYears;
      }
      // rep_teams may arrive as the new by-year shape ({ "2026": {rep:team} })
      // or the legacy flat shape ({ rep:team }). Detect and normalize into the
      // by-year structure; _hydrateTeamYears folds legacy data into this year.
      {
        const rt = (data.rep_teams && typeof data.rep_teams === 'object' && !Array.isArray(data.rep_teams)) ? data.rep_teams : {};
        const keys = Object.keys(rt);
        const looksByYear = keys.length === 0 || keys.every(k => /^\d{4}$/.test(k) && rt[k] && typeof rt[k] === 'object');
        state._indicatorRepTeamByYear = looksByYear ? rt : { [String(new Date().getFullYear())]: rt };
      }
      state._indicatorRepTier       = data.rep_tiers     && typeof data.rep_tiers     === 'object' ? data.rep_tiers     : (state._indicatorRepTier || {});
      state._indicatorRepActive     = data.rep_active    && typeof data.rep_active    === 'object' ? data.rep_active    : (state._indicatorRepActive || {});
      state._indicatorRepOffice     = data.rep_offices   && typeof data.rep_offices   === 'object' ? data.rep_offices   : (state._indicatorRepOffice || {});
      _normalizeRepKeyedMaps();
      if (typeof _hydrateTeamYears === 'function') _hydrateTeamYears();
      // The server copy is now our baseline — record it so this browser
      // counts as CLEAN until the user actually changes something here.
      _indCfgRecordSynced(data.updated_at);
      return;
    }
    // Server row is empty (fresh install). If THIS browser has team data
    // in localStorage, mirror it up — one-time migration so the user
    // doesn't lose what they already configured locally.
    const localHasData =
      (state._indicatorTeams || []).length > 0 ||
      Object.keys(state._indicatorRepTeam || {}).length > 0 ||
      Object.keys(state._indicatorRepTier || {}).length > 0;
    if (localHasData && isAdminRole(state.profile?.role)) {
      console.info('[ridd] migrating indicator config from localStorage → Supabase');
      await _indicatorConfigUpsertNow();   // direct — bypasses the clean-skip (fresh server row)
    }
  } catch (err) {
    console.warn('[ridd] indicator config load threw', err);
  }
}

// ── Config-sync dirty tracking ──────────────────────────────────────────
// THE ROSTER-WIPE BUG: every save used to push this browser's ENTIRE config
// blob to the server — including routine background saves (the auto-derived
// snapshot every 30 minutes). Any open tab holding OLDER rosters/teams would
// rhythmically clobber the server copy, and the admin who actually did the
// work got their edits wiped on the next reload. Now a browser only PUSHES
// when its config CONTENT actually changed since the last sync it saw, and
// only APPLIES the server copy when it has no unsynced edits of its own.
const IND_CFG_SYNC_KEY = 'ridd-ind-cfg-sync-v1';
function _indCfgFingerprint() {
  // NOTE: _indicatorActiveCompId is deliberately NOT part of the fingerprint.
  // The Competitions tab moves that pointer whenever someone just LOOKS at a
  // different comp — including it made every browsing admin count as having
  // "unsynced edits", which pinned their device to a stale local config (and
  // pushed it up). Viewing is not editing.
  const s = JSON.stringify([
    state._indicatorTeams || [], state._indicatorTeamColors || {}, state._indicatorTeamLogos || {},
    state._indicatorExcludedTeams || [],
    { list: state._indicatorCompetitions || [], removed: state._indicatorRemovedDefaults || [], rankExclude: state._indicatorRankExclude || {}, repAlias: state._indicatorRepAlias || {}, dupesDismissed: state._indicatorDismissedDupes || [], tierYears: state._indicatorRepTierYear || {}, extras: state._compExtras || {}, pillOrder: state._compPillOrder || [], favMystery: !!state._compFavoriteMystery },
    state._indicatorRepTeamByYear || {}, state._indicatorRepTier || {}, state._indicatorRepActive || {}, state._indicatorRepOffice || {},
  ]);
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return h + ':' + s.length;
}
function _indCfgSyncRec() { try { return JSON.parse(localStorage.getItem(IND_CFG_SYNC_KEY) || 'null'); } catch { return null; } }
function _indCfgRecordSynced(serverAt) {
  try { localStorage.setItem(IND_CFG_SYNC_KEY, JSON.stringify({ hash: _indCfgFingerprint(), serverAt: serverAt || new Date().toISOString() })); } catch {}
}
function _indCfgDirty() {
  const r = _indCfgSyncRec();
  // No baseline yet (first boot after this fix deployed): treat as CLEAN so
  // this browser ADOPTS the server copy instead of pushing whatever stale
  // config it happens to hold. A baseline is recorded on that first apply,
  // and real edits diverge from it from then on.
  if (!r) return false;
  return r.hash !== _indCfgFingerprint();
}

// Push the in-memory state up to Supabase. Always also writes localStorage
// (via the caller — saveIndicatorState — so localStorage stays a fast
// local cache). Fire-and-forget pattern means UI never blocks waiting on
// the network; failures surface as a toast and a console warning.
async function _indicatorConfigUpsertNow() {
  const payload = {
    id: 1,
    teams:         state._indicatorTeams || [],
    team_colors:   state._indicatorTeamColors || {},
    team_logos:    state._indicatorTeamLogos || {},
    team_excluded: state._indicatorExcludedTeams || [],
    competitions:  { active: state._indicatorActiveCompId || null, list: state._indicatorCompetitions || [], removed: state._indicatorRemovedDefaults || [], rankExclude: state._indicatorRankExclude || {}, repAlias: state._indicatorRepAlias || {}, dupesDismissed: state._indicatorDismissedDupes || [], tierYears: state._indicatorRepTierYear || {}, extras: state._compExtras || {}, pillOrder: state._compPillOrder || [], favMystery: !!state._compFavoriteMystery },
    rep_teams:     state._indicatorRepTeamByYear || {},
    rep_tiers:     state._indicatorRepTier || {},
    rep_active:    state._indicatorRepActive || {},
    rep_offices:   state._indicatorRepOffice || {},
    updated_at:    new Date().toISOString(),
    updated_by:    state.profile?.id || null,
  };
  try {
    // COMPARE-AND-SWAP first (indicator_config_cas.sql): the server rejects
    // any write based on an outdated copy, which deterministically ends the
    // "stale device rolls back everyone's config" class of incident. Falls
    // back to the old direct upsert until the SQL has been run.
    const _basedOn = (_indCfgSyncRec() || {}).serverAt || null;
    const { data: casRes, error: casErr } = await supabase
      .rpc('save_indicator_config', { payload, based_on: _basedOn });
    if (!casErr && casRes && casRes.ok) {
      _indCfgRecordSynced(casRes.server_updated_at || payload.updated_at);
      _mirrorNrlaRostersToRows();              // stage-1 dual-write (additive, never blocks)
      return true;
    }
    if (!casErr && casRes && casRes.conflict) {
      // Our edits were based on an outdated config. Server wins: adopt the
      // current copy (the loader's escape hatch applies it since the server
      // is past our baseline).
      console.warn('[ridd] config write rejected by CAS — server moved past this browser; adopting server copy');
      const _preHash = _indCfgFingerprint();
      try { await loadIndicatorConfigFromSupabase(); if (typeof mountApp === 'function') mountApp(); } catch { /* next poll heals */ }
      // Only bother the admin when adopting the server copy actually CHANGED
      // something locally — background housekeeping saves (auto-reactivation,
      // boot syncs) hit this race with nothing at stake, and the old red
      // "re-apply your change" toast was pure confusion in that case.
      try {
        if (_indCfgFingerprint() !== _preHash) {
          toast('Another device updated settings first — pulled the latest. If you just changed something, re-apply it.', 'warn');
        }
      } catch { /* boot */ }
      return true; // handled — do NOT retry the stale payload
    }
    if (casErr && !/function|schema cache|does not exist|404/i.test(casErr.message || '')) {
      console.warn('[ridd] save_indicator_config RPC failed', casErr);
      if (typeof toast === 'function') toast('Saved locally — server sync failed (' + (casErr.message || 'unknown') + '), retrying…', 'error');
      return false;
    }
    // RPC not installed yet — legacy direct upsert.
    const { error } = await supabase.from('indicator_config').upsert(payload, { onConflict: 'id' });
    if (error) {
      console.warn('[ridd] indicator_config upsert failed', error);
      if (typeof toast === 'function') toast('Saved locally — server sync failed (' + (error.message || 'unknown') + '), retrying…', 'error');
      return false;
    }
    _indCfgRecordSynced(payload.updated_at);   // this content is now the shared truth
    _mirrorNrlaRostersToRows();                // stage-1 dual-write (additive, never blocks)
    return true;
  } catch (err) {
    console.warn('[ridd] indicator_config save threw', err);
    return false;
  }
}
// Single-flight + trailing sync. Rapid edits (roster checkboxes, drag-and-
// drop) used to fire DOZENS of concurrent upserts whose arrival order
// Postgres doesn't guarantee — an early payload could land LAST and roll the
// server copy back, and the next refresh would then clobber the local work
// with that stale row. Now: one request in flight at a time, the payload is
// always rebuilt from CURRENT state at send time, edits made mid-flight
// trigger one trailing send, and failures retry (capped).
let _indCfgUpsertBusy = false, _indCfgUpsertAgain = false, _indCfgUpsertFails = 0;
async function saveIndicatorConfigToSupabase() {
  if (DEMO || !state.profile || !isAdminRole(state.profile?.role)) return;
  // Nothing actually changed since the last sync this browser saw? Then
  // DON'T touch the server — this is what stops background saves in stale
  // tabs from clobbering another admin's fresh roster work.
  if (!_indCfgDirty()) return;
  if (_indCfgUpsertBusy) { _indCfgUpsertAgain = true; return; }
  _indCfgUpsertBusy = true;
  try {
    let ok = await _indicatorConfigUpsertNow();
    while (_indCfgUpsertAgain) { _indCfgUpsertAgain = false; ok = await _indicatorConfigUpsertNow(); }
    if (ok) _indCfgUpsertFails = 0;
    else if (++_indCfgUpsertFails <= 5) setTimeout(() => saveIndicatorConfigToSupabase().catch(() => {}), 3000);
  } finally {
    _indCfgUpsertBusy = false;
  }
}

// ── #1 STAGE 1 — normalized roster rows (dual-write) ────────────────────
// The long-term home for rosters is a real table (indicator_rosters — see
// indicator_rosters.sql) instead of one JSON blob: per-row writes, per-row
// timestamps, realtime. Stage 1 = DUAL-WRITE only: every successful config
// sync also mirrors the NRLA rosters into rows, while the blob remains the
// source of truth. Stage 2 (after the season) cuts reads over to the rows;
// stage 3 drops rosters from the blob. A mirror failure never affects the
// blob save — this path is strictly additive.
let _rosterMirrorBusy = false, _rosterMirrorAgain = false;
async function _mirrorNrlaRostersToRows() {
  if (DEMO || !state.profile || !isAdminRole(state.profile?.role)) return;
  if (_rosterMirrorBusy) { _rosterMirrorAgain = true; return; }
  _rosterMirrorBusy = true;
  try {
    do {
      _rosterMirrorAgain = false;
      const comps = (state._indicatorCompetitions || []).filter(c => c && typeof isNrlaComp === 'function' && isNrlaComp(c));
      for (const comp of comps) {
        const cfg = (comp.nrla && typeof comp.nrla === 'object') ? comp.nrla : {};
        const rosters = (cfg.rosters && typeof cfg.rosters === 'object') ? cfg.rosters : {};
        const repIds = (cfg.repIds && typeof cfg.repIds === 'object') ? cfg.repIds : {};
        const rows = [];
        Object.entries(rosters).forEach(([team, list]) => (Array.isArray(list) ? list : []).forEach(rep => rows.push({
          comp_id: comp.id,
          team: String(team).toUpperCase(),
          rep_name: String(rep),
          rep_id: repIds[rep] || null,
          updated_by: state.profile?.id || null,
        })));
        window._rosterMirrorAt = Date.now();
        const del = await supabase.from('indicator_rosters').delete().eq('comp_id', comp.id);
        if (del.error) throw del.error;
        if (rows.length) {
          const ins = await supabase.from('indicator_rosters').insert(rows);
          if (ins.error) throw ins.error;
        }
      }
    } while (_rosterMirrorAgain);
  } catch (err) {
    healthReport('rosters', false, err);
  } finally {
    _rosterMirrorBusy = false;
  }
}
// Realtime foundation — hear other admins' roster changes the moment they
// land (stage 2 will auto-apply them; stage 1 just tells you).
function subscribeRosterRealtime() {
  if ((typeof DEMO !== 'undefined' && DEMO) || window._rosterRtSub || !state.profile) return;
  try {
    window._rosterRtSub = supabase.channel('indicator_rosters_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'indicator_rosters' }, () => {
        if (Date.now() - (window._rosterMirrorAt || 0) < 10000) return;      // our own mirror
        if (window._rosterRtToastAt && Date.now() - window._rosterRtToastAt < 30000) return;
        window._rosterRtToastAt = Date.now();
        // (Toast retired per Isaac, Sep 2026 — the whole app re-syncs on its
        // own now, so a roster-only "refresh to pull the latest" nag was
        // misleading. The subscription stays for the stage-2 auto-apply.)
      })
      .subscribe();
  } catch (e) { console.warn('[ridd] roster realtime subscribe failed', e); }
}

// ── My-sales realtime — the transparency loop for reps ───────────────────
// When an admin audits / stages one of MY sales, my open tab hears it and
// toasts immediately: no more "did my sale pass?" texts. RLS scopes the feed
// to rows the rep can read; requires sales in the realtime publication
// (sales_realtime.sql).
function subscribeMySalesRealtime() {
  if ((typeof DEMO !== 'undefined' && DEMO) || window._mySalesRtSub || !state.profile) return;
  if (isAdminRole(state.profile?.role) || isAuditorRole(state.profile?.role)) return;   // reps only
  try {
    const seen = (window._mySalesRtSeen = window._mySalesRtSeen || new Set());
    window._mySalesRtSub = supabase.channel('my_sales_rt')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'sales', filter: 'rep_id=eq.' + state.profile.id }, (payload) => {
        const row = payload.new || {};
        const key = row.id + ':' + row.audit_status + ':' + (row.staged_for_payroll ? 1 : 0);
        if (seen.has(key)) return;
        seen.add(key);
        const who = row.customer_name || 'your sale';
        if (row.staged_for_payroll) {
          toast(who + ' just staged for payroll', 'success');
        } else if (row.audit_status && row.audit_status !== 'pending') {
          const nice = String(row.audit_status).replace(/_/g, ' ');
          toast((row.audit_status === 'cancelled' || row.audit_status === 'nsf' ? '⚠ ' : '✅ ') + who + ' — audit: ' + nice, row.audit_status === 'cancelled' ? 'warn' : 'success');
        } else return;
        // Refresh the rep's own lists so the row they're looking at updates.
        refreshSalesData().then(() => { if (INSIDE_SALES_TAB_KEYS.has(state.view)) mountApp(); }).catch(() => {});
      })
      .subscribe();
  } catch (e) { console.warn('[ridd] my-sales realtime subscribe failed', e); }
}

// ── Config history & restore ────────────────────────────────────────────
// Every write to indicator_config is snapshotted server-side by a DB trigger
// (indicator_config_history.sql — last 50 kept). This modal lists snapshots
// and restores any of them: applied locally, then pushed as the new shared
// copy (the restore makes this browser dirty, so the normal sync sends it up).
function _applyIndicatorConfigSnapshot(data) {
  if (!data || typeof data !== 'object') return;
  state._indicatorTeams         = Array.isArray(data.teams) ? data.teams : [];
  state._indicatorTeamColors    = data.team_colors  && typeof data.team_colors  === 'object' ? data.team_colors  : {};
  state._indicatorTeamLogos     = data.team_logos   && typeof data.team_logos   === 'object' ? data.team_logos   : {};
  state._indicatorExcludedTeams = Array.isArray(data.team_excluded) ? data.team_excluded : [];
  if (data.competitions && typeof data.competitions === 'object') {
    if (Array.isArray(data.competitions.list)) state._indicatorCompetitions = data.competitions.list;
    if (data.competitions.active)              state._indicatorActiveCompId = data.competitions.active;
    if (Array.isArray(data.competitions.removed)) state._indicatorRemovedDefaults = data.competitions.removed;
  }
  const rt = (data.rep_teams && typeof data.rep_teams === 'object' && !Array.isArray(data.rep_teams)) ? data.rep_teams : {};
  const keys = Object.keys(rt);
  const looksByYear = keys.length === 0 || keys.every(k => /^\d{4}$/.test(k) && rt[k] && typeof rt[k] === 'object');
  state._indicatorRepTeamByYear = looksByYear ? rt : { [String(new Date().getFullYear())]: rt };
  state._indicatorRepTier   = data.rep_tiers   && typeof data.rep_tiers   === 'object' ? data.rep_tiers   : {};
  state._indicatorRepActive = data.rep_active  && typeof data.rep_active  === 'object' ? data.rep_active  : {};
  state._indicatorRepOffice = data.rep_offices && typeof data.rep_offices === 'object' ? data.rep_offices : {};
  if (typeof _normalizeRepKeyedMaps === 'function') _normalizeRepKeyedMaps();
  if (typeof _hydrateTeamYears === 'function') _hydrateTeamYears();
}
async function openIndicatorConfigHistoryModal() {
  if (!state.profile || !isAdminRole(state.profile?.role)) { toast('Admins only', 'error'); return; }
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => overlay.remove();
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card w-full max-w-xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-center justify-between px-5 py-4 border-b', style: { borderColor: 'var(--border)' } },
      el('div', {},
        el('h2', { class: 'text-base font-bold' }, '🕘 Config history'),
        el('div', { class: 'text-[11px] mt-0.5', style: { color: 'var(--text-muted)' } },
          'Teams · rosters · competitions — every change, last 50 snapshots. Restore rolls the shared config back for every admin.')),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', style: { color: 'var(--text-muted)' }, onclick: close }, '×')),
    el('div', { class: 'p-6 text-center text-sm', style: { color: 'var(--text-muted)' } }, 'Loading…'));
  overlay.append(card);
  document.body.append(overlay);
  let rows = [];
  try {
    const { data, error } = await supabase.from('indicator_config_history')
      .select('id, saved_at, updated_by, config').order('id', { ascending: false }).limit(50);
    if (error) throw error;
    rows = data || [];
  } catch (err) {
    card.lastChild.textContent = 'History unavailable — run indicator_config_history.sql in the Supabase SQL editor first. (' + ((err && err.message) || err) + ')';
    return;
  }
  if (!rows.length) { card.lastChild.textContent = 'No snapshots yet — they appear as config changes are saved.'; return; }
  const summarize = (cfg) => {
    try {
      const comps = (cfg.competitions && cfg.competitions.list) || [];
      const nrla = comps.find(c => c && (c.scoring === 'nrla' || /\bnrla\b/i.test(c.name || '')));
      const rosters = (nrla && nrla.nrla && nrla.nrla.rosters) || {};
      const nRost = Object.values(rosters).reduce((a, l) => a + (Array.isArray(l) ? l.length : 0), 0);
      return (cfg.teams || []).length + ' teams · ' + comps.length + ' comps · ' + nRost + ' rostered reps';
    } catch (e) { return ''; }
  };
  const who = (id) => { const p = (state.allProfiles || []).find(x => x.id === id); return p ? (p.full_name || p.email || '') : ''; };
  const body = el('div', { class: 'overflow-y-auto flex-1' });
  rows.forEach((r, i) => {
    const t = r.saved_at ? new Date(r.saved_at) : null;
    const when = t ? t.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }) : '—';
    body.append(el('div', { class: 'flex items-center justify-between gap-3 px-5 py-2.5 border-b', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'min-w-0' },
        el('div', { class: 'text-sm font-bold' }, when,
          i === 0 ? el('span', { class: 'ml-2 text-[9px] uppercase tracking-wider font-bold px-1.5 py-0.5 rounded', style: { background: 'rgba(255,107,61,.15)', color: '#DF643A' } }, 'current') : null),
        el('div', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, summarize(r.config) + (who(r.updated_by) ? ' · by ' + who(r.updated_by) : ''))),
      i === 0 ? null : el('button', {
        class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold cursor-pointer shrink-0',
        style: { background: '#F2148C', color: '#fff' },
        onclick: () => {
          if (!confirm('Restore the config from ' + when + '? This becomes the shared copy for every admin.')) return;
          _applyIndicatorConfigSnapshot(r.config);
          logActivity('comp_change', { detail: 'Config restored from history snapshot ' + when });
          saveDemoData();                        // local save; dirty → pushes to the server
          toast('Config restored from ' + when + ' — syncing to the server…', 'success');
          close();
          mountApp();
        },
      }, 'Restore')));
  });
  card.replaceChild(body, card.lastChild);
}

// ── Company logo (drives the raffle-spin hub today; can be reused for
// auth/header branding later) ─────────────────────────────────────────────
// Mirrored through public.app_settings under key 'company_logo' so any
// admin uploading from any browser updates everyone's view. localStorage
// is the local cache for instant reads while Supabase is in flight.
const RIDD_LOGO_STORAGE_KEY = 'ridd-spin-logo-v1';
async function loadCompanyLogo() {
  // localStorage first — instant, no network.
  try {
    const local = localStorage.getItem(RIDD_LOGO_STORAGE_KEY);
    if (local) state.companyLogo = local;
  } catch {}
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase
      .from('app_settings').select('value').eq('key', 'company_logo').maybeSingle();
    if (error) { console.warn('[ridd] company_logo select failed', error); return; }
    const serverLogo = data?.value?.data_url;
    if (serverLogo) {
      state.companyLogo = serverLogo;
      try { localStorage.setItem(RIDD_LOGO_STORAGE_KEY, serverLogo); } catch {}
    } else if (state.companyLogo && isAdminRole(state.profile?.role)) {
      // Server row is empty but this browser has a saved logo (one-time
      // migration after we enabled cross-browser sync). Push it up.
      saveCompanyLogo(state.companyLogo).catch(() => {});
    }
  } catch (err) { console.warn('[ridd] company_logo load threw', err); }
}
async function saveCompanyLogo(dataUrl) {
  state.companyLogo = dataUrl || '';
  try {
    if (dataUrl) localStorage.setItem(RIDD_LOGO_STORAGE_KEY, dataUrl);
    else         localStorage.removeItem(RIDD_LOGO_STORAGE_KEY);
  } catch {}
  if (DEMO || !supabase || !state.profile) return;
  if (!isAdminRole(state.profile?.role)) return;
  try {
    const { error } = await supabase.from('app_settings').upsert(
      { key: 'company_logo', value: dataUrl ? { data_url: dataUrl } : {} },
      { onConflict: 'key' }
    );
    if (error) {
      console.warn('[ridd] company_logo upsert failed', error);
      if (typeof toast === 'function') toast('Saved locally — server sync failed (' + (error.message || 'unknown') + ')', 'warn');
    }
  } catch (err) { console.warn('[ridd] company_logo save threw', err); }
}

// ── Commission calculator config (shared across admins via app_settings) ──
// One JSON row holds: per-rep negotiated rates, the service→category map, and
// the multi-year bonus thresholds. Money config, so it lives server-side (not
// localStorage) to stay consistent for everyone.
const COMMISSION_MY_DEFAULT = { hiPct: 75, loPct: 55, rate18: 2, rate24: 3, penalty: 5 };
// Default rate model (matches the Retool backend): Pest % is the base; Ancillary
// and Bundle are MULTIPLES of the pest rate.
const COMMISSION_RATE_DEFAULT = { pest: 0.20, ancMult: 0.5, bundleMult: 0.8 };
const COMMISSION_REP_TYPES = ['Office Staff', 'Sales Rep', 'Technician'];
function commissionConfig() {
  const c = state.commissionConfig || {};
  return {
    repRates:          c.repRates || {},          // { [empId]: { pest, ancMult, bundleMult } } — per-rep OVERRIDE
    typeRules:         c.typeRules || {},         // { [repType]: { pest, ancMult, bundleMult, multiYear:{...} } } — defaults by rep type
    serviceCategories: c.serviceCategories || {}, // { [serviceName]: 'pest'|'bundle'|'ancillary'|'exclude' }
    multiYear:         Object.assign({}, COMMISSION_MY_DEFAULT, c.multiYear || {}), // legacy company-wide fallback
    manual:            c.manual || {},            // { [empId]: { overrides, rent, paidYtd, other, audit, payPeriods } } — shared
    published:         c.published || {},         // { [empId]: { ...breakdown, period, at } } — what reps see
    upfrontTypeRules:  c.upfrontTypeRules || {},  // { [repType]: { pest, bundle, anc } } — UPFRONT rate defaults (fractions)
    upfrontRepRates:   c.upfrontRepRates || {},   // { [empId]: { pest, bundle, anc } } — per-rep upfront override
    d2dPayscales:      c.d2dPayscales || null,     // Sales Rep payscale ladders (Rookie / Veteran / Elite / Pro) — see D2D_PAYSCALE_DEFAULTS
  };
}
// Upfront pay model — category rates paid on contract value off the top
// (the old season pay-stub tool: Pest 60% / Bundle 48% / Ancillary 30%).
// Backend ("holistic") rates live in typeRules above; these are separate.
const UPFRONT_RATE_DEFAULT = { pest: 0.60, bundle: 0.48, anc: 0.30 };
function upfrontRulesForType(typeLabel) {
  const t = commissionConfig().upfrontTypeRules[typeLabel] || {};
  return {
    pest:   t.pest   != null ? Number(t.pest)   : UPFRONT_RATE_DEFAULT.pest,
    bundle: t.bundle != null ? Number(t.bundle) : UPFRONT_RATE_DEFAULT.bundle,
    anc:    t.anc    != null ? Number(t.anc)    : UPFRONT_RATE_DEFAULT.anc,
  };
}
function upfrontRatesFor(empId, typeLabel) {
  const base = upfrontRulesForType(typeLabel);
  const r = commissionConfig().upfrontRepRates[empId] || {};
  return {
    pest:   r.pest   != null ? Number(r.pest)   : base.pest,
    bundle: r.bundle != null ? Number(r.bundle) : base.bundle,
    anc:    r.anc    != null ? Number(r.anc)    : base.anc,
    overridden: (r.pest != null || r.bundle != null || r.anc != null),
  };
}
// The rule set for a rep TYPE — type config layered over company defaults.
function commissionRulesForType(typeLabel) {
  const cfg = commissionConfig();
  const t = cfg.typeRules[typeLabel] || {};
  return {
    pest:       t.pest != null ? Number(t.pest) : COMMISSION_RATE_DEFAULT.pest,
    ancMult:    t.ancMult != null ? Number(t.ancMult) : COMMISSION_RATE_DEFAULT.ancMult,
    bundleMult: t.bundleMult != null ? Number(t.bundleMult) : COMMISSION_RATE_DEFAULT.bundleMult,
    multiYear:  Object.assign({}, COMMISSION_MY_DEFAULT, cfg.multiYear, t.multiYear || {}),
  };
}
// Effective rates for a specific rep: per-rep override → rep-type default → company default.
function commissionRatesFor(empId, typeLabel) {
  const base = commissionRulesForType(typeLabel);
  const r = commissionConfig().repRates[empId] || {};
  const pest = r.pest != null ? Number(r.pest) : base.pest;
  const ancMult = r.ancMult != null ? Number(r.ancMult) : base.ancMult;
  const bundleMult = r.bundleMult != null ? Number(r.bundleMult) : base.bundleMult;
  return { pest, ancMult, bundleMult, ancRate: pest * ancMult, bundleRate: pest * bundleMult,
           overridden: (r.pest != null || r.ancMult != null || r.bundleMult != null) };
}
// CAS write for a shared setting (save_app_setting RPC, app_settings_cas.sql).
// `state._settingsSeen[key]` is the server updated_at we last loaded; a
// write based on an older copy is refused and the caller reloads instead
// of clobbering another admin's edit. Falls back to the plain upsert when
// the RPC isn't installed yet.
async function saveAppSettingCas(key, value, onConflict) {
  if (typeof trackAction === 'function') trackAction('setting_save', key);
  const seen = (state._settingsSeen || {})[key] || null;
  try {
    const { data, error } = await supabase.rpc('save_app_setting', { p_key: key, p_value: value, based_on: seen });
    if (error && /function|does not exist|schema cache/i.test(error.message || '')) {
      const r = await supabase.from('app_settings').upsert({ key, value }, { onConflict: 'key' });
      return r.error ? { ok: false, error: r.error } : { ok: true };
    }
    if (error) return { ok: false, error };
    if (data && data.ok) { (state._settingsSeen = state._settingsSeen || {})[key] = data.updated_at; return { ok: true }; }
    if (data && data.conflict) { if (onConflict) await onConflict(data); return { ok: false, conflict: true }; }
    return { ok: false, error: new Error((data && data.error) || 'save refused') };
  } catch (e) { return { ok: false, error: e }; }
}
async function loadCommissionConfig() {
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const { data, error } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'commission_config').maybeSingle();
    if (error) { healthReport('commission', false, error); return; }
    healthReport('commission', true);
    if (data && data.value) { state.commissionConfig = data.value; (state._settingsSeen = state._settingsSeen || {}).commission_config = data.updated_at; }
  } catch (e) { healthReport('commission', false, e); }
}
async function saveCommissionConfig(next) {
  state.commissionConfig = next;
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const r = await saveAppSettingCas('commission_config', next, async () => {
      await loadCommissionConfig();
      toast('Another admin changed Commissions settings since you opened them — reloaded the latest, please re-apply your edit', 'warn');
      mountApp();
    });
    if (!r.ok && !r.conflict) { healthReport('commission', false, r.error); if (typeof toast === 'function') toast('Saved locally — server sync failed', 'warn'); }
  } catch (e) { healthReport('commission', false, e); }
}
// ── Company goal (annual target + monthly allocation) — shared via app_settings ──
// In demo mode this lives in the demo snapshot; in production it persists to
// app_settings under 'company_goal' so the Goals tab survives a reload.
async function loadCompanyGoal() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase.from('app_settings').select('value').eq('key', 'company_goal').maybeSingle();
    if (error) { console.warn('[ridd] company_goal load failed', error); return; }
    if (data && data.value) state.companyGoal = data.value;
  } catch (e) { console.warn('[ridd] company_goal load threw', e); }
}
async function saveCompanyGoal() {
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const { error } = await supabase.from('app_settings').upsert({ key: 'company_goal', value: state.companyGoal }, { onConflict: 'key' });
    if (error) { console.warn('[ridd] company_goal save failed', error); if (typeof toast === 'function') toast('Saved locally — server sync failed', 'warn'); }
  } catch (e) { console.warn('[ridd] company_goal save threw', e); }
}
// ── Pay settings (Inside Sales / Office Staff pay rules) — shared via
// app_settings key 'pay_settings'. Holds contract-type rates, below-min,
// PIF/commercial overrides, renewal flat $, backend rates, close-rate tiers.
// In demo mode these ride along in the demo snapshot; in production they
// persist here so the Office Staff rules (and the Pay tab math) survive a
// reload. Loaded for any signed-in user so reps see correct pay; saved by
// admins only.
async function loadAutologSwitch() {
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
    state._autologCache = (data && data.value) || null;
  } catch (e) { /* stays manual */ }
}
async function loadAppSettings() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase.from('app_settings').select('value, updated_at').eq('key', 'pay_settings').maybeSingle();
    if (error) { healthReport('pay', false, error); return; }
    healthReport('pay', true);
    if (data && data.value) { state.appSettings = Object.assign({}, state.appSettings, data.value); (state._settingsSeen = state._settingsSeen || {}).pay_settings = data.updated_at; }
  } catch (e) { healthReport('pay', false, e); }
}
// Per-pay-period "Other Pay" lines (per Isaac: bonuses, competition earnings
// and the like, entered by hand each pay period). RLS: reps read their own,
// admins read/write all. Loaded for everyone so the stub shows them.
async function loadPayAdjustments() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase.from('pay_adjustments').select('*').order('created_at');
    if (error) { if (!/pay_adjustments/i.test(error.message || '')) console.warn('[ridd] pay_adjustments load failed', error); return; }
    state.payAdjustments = data || [];
  } catch (e) { console.warn('[ridd] pay_adjustments load threw', e); }
}
async function addPayAdjustment(repId, year, periodId, amount, label) {
  const row = { rep_id: repId, period_year: year, period_id: periodId, amount, label: label || '', created_by: state.profile.id };
  if (DEMO || !supabase) { state.payAdjustments.push({ id: 'demo-' + Date.now(), ...row, created_at: new Date().toISOString() }); return true; }
  const { data, error } = await supabase.from('pay_adjustments').insert(row).select('*').single();
  if (error) { toast('Could not save: ' + error.message, 'error'); return false; }
  state.payAdjustments.push(data);
  logActivity('config_change', { detail: 'Other Pay +' + amount + ' (' + (label || 'no label') + ') for ' + repId + ' · ' + year + '/' + periodId });
  return true;
}
async function removePayAdjustment(id) {
  if (!DEMO && supabase) {
    const { error } = await supabase.from('pay_adjustments').delete().eq('id', id);
    if (error) { toast('Could not remove: ' + error.message, 'error'); return false; }
  }
  state.payAdjustments = state.payAdjustments.filter(a => a.id !== id);
  return true;
}
async function saveAppSettings() {
  if (DEMO || !supabase || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const r = await saveAppSettingCas('pay_settings', state.appSettings, async () => {
      await loadAppSettings();
      toast('Another admin changed Pay settings since you opened them — reloaded the latest, please re-apply your edit', 'warn');
      mountApp();
    });
    if (!r.ok && !r.conflict) { healthReport('pay', false, r.error); if (typeof toast === 'function') toast('Saved locally — server sync failed', 'warn'); }
  } catch (e) { healthReport('pay', false, e); }
}
// Publish one rep's computed breakdown to the per-rep, RLS-protected results
// table so that rep (and only that rep) can see it in "My Commission".
async function publishCommissionResult(empId, data, period) {
  if (DEMO || !supabase || !isAdminRole(state.profile?.role)) return { ok: false };
  try {
    const { error } = await supabase.from('commission_results').upsert({
      employee_id: String(empId), data,
      period_start: (period && period.start) || null, period_end: (period && period.end) || null,
      published_by: state.profile.id, published_at: new Date().toISOString(),
    }, { onConflict: 'employee_id' });
    if (error) { console.warn('[ridd] commission publish failed (run commission_results.sql?)', error); return { ok: false, msg: error.message }; }
    return { ok: true };
  } catch (e) { console.warn('[ridd] commission publish threw', e); return { ok: false, msg: String(e) }; }
}
// A rep loads ONLY their own published row (RLS keys on their linked id).
async function loadMyCommissionResult() {
  if (DEMO || !supabase || !state.profile) { state._myCommissionLoaded = true; return; }
  try {
    let q = supabase.from('commission_results').select('*');
    if (state.profile.fieldroutes_employee_id) q = q.eq('employee_id', String(state.profile.fieldroutes_employee_id));
    const { data, error } = await q.maybeSingle();
    state._myCommission = (!error && data) ? data : null;
  } catch (e) { state._myCommission = null; }
  state._myCommissionLoaded = true;
}

// ── Reporting tab loaders ────────────────────────────────────────────────
// Two-tier load: metadata (uploads list + service config) loads on app
// boot so the Reporting tab can render instantly. Subscription rows are
// lazy-loaded on demand when an upload is selected — those can be tens
// of thousands of rows and shouldn't block first paint.
async function loadReportingMetadata() {
  if (DEMO || !state.profile || !isAdminRole(state.profile?.role)) return;
  try {
    const [uploadsRes, configRes, cancelCfgRes, sourceCfgRes] = await Promise.all([
      supabase.from('reporting_uploads').select('*').order('uploaded_at', { ascending: false }),
      supabase.from('reporting_service_config').select('*').order('service_name'),
      supabase.from('reporting_cancel_config').select('*').order('reason'),
      supabase.from('reporting_source_config').select('*').order('source'),
    ]);
    if (uploadsRes.error) { console.warn('[ridd] reporting_uploads load failed', uploadsRes.error); }
    if (configRes.error)  { console.warn('[ridd] reporting_service_config load failed', configRes.error); }
    if (cancelCfgRes && cancelCfgRes.error) { console.warn('[ridd] reporting_cancel_config load failed (run reporting_cancel_config.sql)', cancelCfgRes.error); }
    if (sourceCfgRes && sourceCfgRes.error) { console.warn('[ridd] reporting_source_config load failed (run reporting_source_config.sql)', sourceCfgRes.error); }
    if (uploadsRes.error || configRes.error) healthReport('settings', false, (uploadsRes.error || configRes.error)); else healthReport('settings', true);
    state.reportingUploads       = uploadsRes.data || [];
    state.reportingServiceConfig = configRes.data || [];
    state.reportingCancelConfig  = (cancelCfgRes && cancelCfgRes.data) || [];
    state.reportingSourceConfig  = (sourceCfgRes && sourceCfgRes.data) || [];
    // Default the active snapshot to the most recent upload.
    if (!state.reportingActiveUploadId && state.reportingUploads.length) {
      state.reportingActiveUploadId = state.reportingUploads[0].id;
    }
    state._reportingLatestId = state.reportingUploads.length ? state.reportingUploads[0].id : null;
  } catch (err) {
    healthReport('settings', false, err);
  }
}

// ── IndexedDB cache for reporting snapshots ──────────────────────────────
// localStorage is ~5MB and too small for a 77k-row snapshot; IndexedDB holds
// hundreds of MB. We stash the loaded rows keyed by upload id, so a refresh
// on the SAME snapshot reads from local disk in a few ms instead of
// re-downloading everything. A new upload writes a new key and supersedes it.
const REPORTING_IDB_DB = 'ridd-reporting';
const REPORTING_IDB_STORE = 'snapshots';
function _reportingIdb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('no indexeddb'));
    const req = indexedDB.open(REPORTING_IDB_DB, 1);
    req.onupgradeneeded = () => { req.result.createObjectStore(REPORTING_IDB_STORE); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
async function reportingIdbGet(uploadId) {
  try {
    const db = await _reportingIdb();
    return await new Promise((resolve) => {
      const tx = db.transaction(REPORTING_IDB_STORE, 'readonly');
      const r = tx.objectStore(REPORTING_IDB_STORE).get(uploadId);
      r.onsuccess = () => resolve(r.result || null);
      r.onerror = () => resolve(null);
    });
  } catch { return null; }
}
async function reportingIdbPut(uploadId, rows) {
  try {
    const db = await _reportingIdb();
    await new Promise((resolve) => {
      const tx = db.transaction(REPORTING_IDB_STORE, 'readwrite');
      const store = tx.objectStore(REPORTING_IDB_STORE);
      store.put(rows, uploadId);
      // Keep only this snapshot — old ones are stale once a new upload lands.
      const keysReq = store.getAllKeys();
      keysReq.onsuccess = () => {
        (keysReq.result || []).forEach(k => { if (k !== uploadId && !String(k).startsWith('geo:')) store.delete(k); });
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    });
  } catch { /* cache is best-effort */ }
}

// Put without evicting — for static assets (state ZIP boundaries) that
// should outlive snapshot rotations.
async function reportingIdbPutKeep(key, value) {
  try {
    const db = await _reportingIdb();
    await new Promise((resolve) => {
      const tx = db.transaction(REPORTING_IDB_STORE, 'readwrite');
      tx.objectStore(REPORTING_IDB_STORE).put(value, key);
      tx.oncomplete = () => resolve(); tx.onerror = () => resolve();
    });
  } catch { /* best-effort */ }
}

// Phantom offices lingering in the CRM (negative office IDs surface as
// "Office -1" / "Office -7"). They aren't real branches we sold from. The
// sync now filters them at the source, but older snapshots still carry them —
// so we also strip them here, at the single chokepoint every reporting /
// indicators / commission consumer loads through. Revenue, subs, audits,
// everything: gone.
const PHANTOM_OFFICE_NAMES = new Set(['Office -1', 'Office -7']);
function stripPhantomOffices(rows) {
  return Array.isArray(rows) ? rows.filter(r => !PHANTOM_OFFICE_NAMES.has(String(r && r.office_name || '').trim())) : rows;
}
// Background warm-up (per Isaac — the Geographic tab sat on "Downloading
// snapshot…" every morning): once the uploads list is in, quietly pull the
// active snapshot into IndexedDB + state a few seconds after login, with the
// progress toast suppressed. By the time anyone opens Reporting the rows are
// already local. No-op for roles that can't read the snapshot anyway.
function prefetchReportingSnapshot() {
  try {
    const id = state.reportingActiveUploadId;
    if (!id || state.reportingSubscriptionsLoadedFor === id || state._reportingPrefetching) return;
    if (!isAdminRole(state.profile?.role) && !(typeof isOfficeStaffProfile === 'function' && isOfficeStaffProfile(state.profile))) return;
    state._reportingPrefetching = true;
    const run = () => {
      state._reportingSilent = true;
      loadReportingSubscriptions(id).then(rows => {
        if (rows && rows.length && state.reportingActiveUploadId === id && state.reportingSubscriptionsLoadedFor !== id) {
          state.reportingSubscriptions = rows; healthReport('reporting', true);
          state.reportingSubscriptionsLoadedFor = id;
          if (typeof _refreshRepTypeMap === 'function') { try { _refreshRepTypeMap(); } catch (e) { /* optional */ } }
          if (state.view === 'reporting') mountApp();
        }
      }).catch(() => {}).finally(() => { state._reportingSilent = false; state._reportingPrefetching = false; });
    };
    if ('requestIdleCallback' in window) requestIdleCallback(run, { timeout: 8000 }); else setTimeout(run, 3000);
  } catch (e) { state._reportingPrefetching = false; }
}
// Snapshot-side guard for transferred accounts (until the sync's dedupe has
// run): if a snapshot carries the same subscription twice, keep the copy
// whose office matches the row's own customer office — or simply the last
// one seen — so a moved account isn't counted under both branches.
function dedupeSnapshotSubs(rows) {
  if (!Array.isArray(rows) || !rows.length || rows[0].subscription_id == null) return rows;
  const seen = new Map();
  for (const r of rows) { const k = String(r.subscription_id || ''); if (!k) continue; seen.set(k, r); }
  return rows.filter(r => !r.subscription_id || seen.get(String(r.subscription_id)) === r);
}
// Renewal chaining (per Isaac, Sep 2026): when a customer's sub is closed
// with a "Renewal - …" reason and a renewal-source sub opens for the same
// customer around the same time, that is ONE relationship changing plans,
// not a churn + a new sale. We keep both rows (the renewal team's sale is
// still a sale) but stamp the renewal sub with the chain's origin so the
// retention cohorts, tenure and unit economics treat it as a continuation:
//   origin_initial_service / origin_sold_date — the very first sub's dates
//   renewal_prev_arv — ARR of the sub it replaced (expansion = new − prev)
//   is_renewal_cont — true on the renewal sub; renewed_into on the old one
function linkRenewalChains(rows) {
  const isRenewalReason = (r) => /^renewal/i.test(String(reportingCancelReasonOf(r) || '').trim());
  const isRenewalSource = (r) => /^renewal/i.test(String(r.subscription_source || '').trim());
  const byCust = new Map();
  for (const r of rows) { const k = r.customer_id != null ? String(r.customer_id) : ''; if (!k) continue; (byCust.get(k) || byCust.set(k, []).get(k)).push(r); }
  const DAY = 86400000, BEFORE = 45 * DAY, AFTER = 60 * DAY;
  const t = (d) => { if (!d) return NaN; const x = new Date(String(d).slice(0, 10) + 'T00:00'); return isNaN(x) ? NaN : x.getTime(); };
  let links = 0;
  for (const subs of byCust.values()) {
    if (subs.length < 2) continue;
    const olds = subs.filter(r => r.subscription_date_canceled && isRenewalReason(r));
    if (!olds.length) continue;
    const news = subs.filter(r => isRenewalSource(r) && r.sold_date).sort((a, b) => String(a.sold_date).localeCompare(String(b.sold_date)));
    const used = new Set();
    for (const n of news) {
      const ns = t(n.sold_date); if (isNaN(ns)) continue;
      let best = null, bestGap = Infinity;
      for (const o of olds) {
        if (o === n || used.has(o)) continue;
        const oc = t(o.subscription_date_canceled); if (isNaN(oc)) continue;
        const gap = ns - oc;                       // + = opened after the close
        if (gap < -BEFORE || gap > AFTER) continue;
        if (Math.abs(gap) < bestGap) { best = o; bestGap = Math.abs(gap); }
      }
      if (!best) continue;
      used.add(best);
      n.is_renewal_cont = true;
      n.origin_initial_service = best.origin_initial_service || best.initial_service || null;
      n.origin_sold_date = best.origin_sold_date || best.sold_date || null;
      n.renewal_prev_arv = Number(best.annual_recurring_value) || 0;
      best.renewed_into = n.subscription_id || true;
      links++;
    }
  }
  state._renewalLinks = links;
  return rows;
}
async function _loadCrmDeletedIds() {
  if (state._crmDeletedLoaded || DEMO || !supabase) return;
  try {
    const { data } = await supabase.from('app_settings').select('value').eq('key', 'crm_deleted').maybeSingle();
    const v = data && data.value;
    state._crmDeletedIds = (v && Array.isArray(v.ids)) ? v.ids.map(x => String(x).trim()).filter(Boolean) : [];
    state._crmDeletedMeta = v ? { scanned_at: v.scanned_at || null, checked: v.checked || 0, mirror: v.mirror || 0 } : null;
  } catch (e) { state._crmDeletedIds = state._crmDeletedIds || []; }
  state._crmDeletedLoaded = true;
}
async function loadReportingSubscriptions(uploadId) {
  const raw = await _loadReportingSubscriptionsRaw(uploadId);
  const noPhantom = stripPhantomOffices(raw);
  const deduped = dedupeSnapshotSubs(noPhantom);
  // Ground-zero bookkeeping (per Isaac): the Retention tab walks down from
  // EVERYTHING in FieldRoutes, so remember what the loader itself dropped.
  state._snapshotLoadDrops = { raw: Array.isArray(raw) ? raw.length : 0, phantom: (Array.isArray(raw) ? raw.length : 0) - (Array.isArray(noPhantom) ? noPhantom.length : 0), dupes: (Array.isArray(noPhantom) ? noPhantom.length : 0) - (Array.isArray(deduped) ? deduped.length : 0) };
  const rows = linkRenewalChains(deduped);
  // Blank / "un" / "unknown" states all group under ?? on the Geographic tab.
  if (typeof _normStateCode === 'function') for (const r of rows) r.state = _normStateCode(r.state);
  // Same guard as the sync: a sub sold in the last 7 days whose customer row
  // hasn't landed yet is a feed lag, not a deleted account (Julia Phillips,
  // #180833 — sold and serviced the day of the sync). Clear the flag so it
  // never shows as an orphan, in the steps or anywhere else.
  const _cut = new Date(); _cut.setDate(_cut.getDate() - 7);
  const _cutIso = _cut.toISOString().slice(0, 10);
  for (const r of rows) if (r.customer_missing && r.sold_date && String(r.sold_date).slice(0, 10) >= _cutIso) r.customer_missing = null;
  // Nightly FieldRoutes scan (app_settings.crm_deleted): customer ids the
  // CRM no longer returns. The mirror never forgets a deleted account, so
  // without this they read as live customers forever (per Isaac).
  await _loadCrmDeletedIds();
  const orphans = rows.filter(r => r.customer_missing);
  state._orphanSubs = orphans;
  state._orphanCustIds = [...new Set(orphans.map(r => String(r.customer_id != null ? r.customer_id : '')).filter(Boolean))];
  const del = deletedCustIdSet();
  // Rows set aside as deleted-in-CRM (orphans + the manual list) are kept in
  // state so the Retention tab can start from the whole snapshot and show
  // this exclusion as a step of its own.
  state._deletedSubs = del.size ? rows.filter(r => del.has(String(r.customer_id != null ? r.customer_id : ''))) : [];
  return del.size ? rows.filter(r => !del.has(String(r.customer_id != null ? r.customer_id : ''))) : rows;
}
// Streamed snapshot download with live progress, stall detection and retries.
// supabase-js .download() is one opaque await — if the connection stalls
// (laptop sleep, flaky wifi, dropped socket) it hangs forever and the toast
// freezes at 15% with no way out. Fetching the storage object directly lets
// us: show a real % from the byte stream, abort whenever no bytes arrive for
// STALL_MS, and retry with backoff before giving up to the paged fallback.
// Pass opts.meta:true to get { blob, etag, lastModified, notModified } back;
// with opts.ifNoneMatch / opts.ifModifiedSince the server can answer 304
// ("you already have this") with NO body — that's what keeps dozens of open
// tabs polling for fresh comp data from costing real bandwidth: unless a new
// sync actually landed, each poll is a ~200-byte round trip instead of a
// multi-MB download.
async function _downloadSnapshotBlob(path, onPct, opts) {
  const STALL_MS = 20000, TRIES = 3;
  const o = opts || {};
  const url = CFG.SUPABASE_URL + '/storage/v1/object/reporting/' + String(path).split('/').map(encodeURIComponent).join('/');
  const { data: { session } = {} } = await supabase.auth.getSession();
  const token = session && session.access_token;
  if (!token) throw new Error('no session for storage download');
  let lastErr = null;
  for (let attempt = 1; attempt <= TRIES; attempt++) {
    const ctrl = new AbortController();
    let watchdog = setTimeout(() => ctrl.abort(), STALL_MS);
    const feed = () => { clearTimeout(watchdog); watchdog = setTimeout(() => ctrl.abort(), STALL_MS); };
    try {
      const headers = { Authorization: 'Bearer ' + token, apikey: CFG.SUPABASE_PUBLISHABLE_KEY };
      if (o.ifNoneMatch) headers['If-None-Match'] = o.ifNoneMatch;
      if (o.ifModifiedSince) headers['If-Modified-Since'] = o.ifModifiedSince;
      const res = await fetch(url, { headers, signal: ctrl.signal, cache: 'no-store' });
      if (res.status === 304) {
        clearTimeout(watchdog);
        return o.meta ? { blob: null, notModified: true, etag: o.ifNoneMatch || null, lastModified: o.ifModifiedSince || null } : null;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      let blob;
      if (!res.body) {
        blob = await res.blob();
      } else {
        const total = Number(res.headers.get('content-length')) || 0;
        const reader = res.body.getReader();
        const chunks = [];
        let got = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          feed();
          chunks.push(value);
          got += value.byteLength;
          if (onPct) onPct(total ? Math.min(0.99, got / total) : null, got);
        }
        blob = new Blob(chunks);
      }
      clearTimeout(watchdog);
      return o.meta
        ? { blob, notModified: false, etag: res.headers.get('etag'), lastModified: res.headers.get('last-modified') }
        : blob;
    } catch (e) {
      clearTimeout(watchdog);
      lastErr = e;
      console.warn('[ridd] snapshot download attempt ' + attempt + '/' + TRIES + ' failed:', (e && e.message) || e);
      if (attempt < TRIES) await new Promise(r => setTimeout(r, 800 * attempt));
    }
  }
  throw lastErr || new Error('snapshot download failed');
}

async function _loadReportingSubscriptionsRaw(uploadId) {
  if (DEMO || !state.profile) return [];
  // Admins + office staff (Work Queues run on this snapshot — office staff
  // are internal and work customer records all day; D2D field reps stay out).
  if (!isAdminRole(state.profile?.role) && !(typeof isOfficeStaffProfile === 'function' && isOfficeStaffProfile(state.profile))) return [];
  if (!uploadId) return [];

  // Fast local cache first — instant on refresh when the snapshot is unchanged.
  const cached = await reportingIdbGet(uploadId);
  if (Array.isArray(cached) && cached.length) return cached;

  // FAST PATH — snapshot stored as one gzipped object in Storage: a single
  // download instead of ~78 paged queries (and nothing to silently drop).
  const metaU = (state.reportingUploads || []).find(u => u.id === uploadId);
  if (metaU && metaU.storage_path) {
    try {
      reportingUploadProgress(5, 'Downloading snapshot…');
      const blob = await _downloadSnapshotBlob(metaU.storage_path, (frac, bytes) => {
        reportingUploadProgress(
          frac == null ? 40 : 5 + Math.round(frac * 70),                     // 5 → 75
          'Downloading snapshot… ' + (bytes / 1048576).toFixed(1) + ' MB');
      });
      reportingUploadProgress(80, 'Unpacking…');
      const text = (metaU.storage_path.endsWith('.gz') && typeof DecompressionStream !== 'undefined')
        ? await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text()
        : await blob.text();
      const rows = JSON.parse(text);
      reportingIdbPut(uploadId, rows); // cache locally for instant refreshes
      reportingUploadProgress(null);
      return rows;
    } catch (e) { console.warn('[ridd] storage load failed — falling back to paged load', e); }
    reportingUploadProgress(null);
  }
  // PostgREST caps each response at 1000 rows, so a 58k-row snapshot needs
  // ~58 pages. Fetching them one-at-a-time (sequential await) is the reason
  // the tab took forever. Instead we read the total count once, then fan the
  // page requests out in parallel (capped concurrency so we don't hammer the
  // connection), which cuts load time roughly to (pages / CONCURRENCY).
  // Page in parallel, but gently (4 at a time) and with RETRIES. Firing 8+
  // requests at once made Supabase reject/timeout most of them; each failed
  // page silently returned empty, so a 77k-row snapshot loaded only ~19k.
  // Retrying each page with backoff means no page is ever silently dropped.
  const CHUNK = 1000, CONCURRENCY = 8, MAX_TRIES = 6;
  const fetchPage = async (from) => {
    for (let t = 0; t < MAX_TRIES; t++) {
      const { data, error } = await supabase
        .from('reporting_subscriptions')
        .select('*')
        .eq('upload_id', uploadId)
        .order('id', { ascending: true })
        .range(from, from + CHUNK - 1);
      if (!error) return data || [];
      await new Promise(r => setTimeout(r, 250 * (t + 1))); // backoff, then retry
    }
    console.warn('[ridd] reporting page at offset', from, 'failed after retries');
    return [];
  };

  // Count probe tells us how many pages to fan out.
  const { count, error: countErr } = await supabase
    .from('reporting_subscriptions')
    .select('id', { count: 'exact', head: true })
    .eq('upload_id', uploadId);

  // Fallback: if the count probe fails, page sequentially (progress measured
  // against the snapshot's known row_count from metadata when available).
  if (countErr || count == null) {
    const metaTotal = (((state.reportingUploads || []).find(u => u.id === uploadId)) || {}).row_count || null;
    const all = [];
    for (let from = 0; ; from += CHUNK) {
      const data = await fetchPage(from);
      all.push(...data);
      reportingUploadProgress(
        metaTotal ? Math.min(99, Math.round(100 * all.length / metaTotal)) : 50,
        'Loading snapshot… ' + all.length.toLocaleString() + (metaTotal ? ' / ' + metaTotal.toLocaleString() : '') + ' rows');
      if (data.length < CHUNK) break;
    }
    reportingIdbPut(uploadId, all);
    reportingUploadProgress(null);
    return all;
  }

  const pages = Math.ceil(count / CHUNK);
  const results = new Array(pages);
  let nextPage = 0, loadedRows = 0, aborted = false;
  reportingUploadProgress(0, 'Loading snapshot… 0 / ' + count.toLocaleString() + ' rows');
  const worker = async () => {
    for (;;) {
      // Bail if a newer snapshot became active mid-load (e.g. a fresh upload
      // landed) — no point finishing a slow paged load whose result will be
      // thrown away, and it keeps a stale progress bar on screen.
      if (state.reportingActiveUploadId !== uploadId) { aborted = true; return; }
      const p = nextPage++;
      if (p >= pages) return;
      results[p] = await fetchPage(p * CHUNK);
      loadedRows += results[p].length;
      reportingUploadProgress(
        Math.min(99, Math.round(100 * loadedRows / Math.max(1, count))),
        'Loading snapshot… ' + loadedRows.toLocaleString() + ' / ' + count.toLocaleString() + ' rows');
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, pages) }, worker));
  if (aborted) {                       // superseded by a newer snapshot
    reportingUploadProgress(null);     // clear the leftover progress bar
    return null;                       // caller's guard ignores a null result
  }
  const loaded = results.flat();
  if (loaded.length < count) {
    healthReport('reporting', false, 'snapshot incomplete: ' + loaded.length + ' of ' + count + ' rows');
  } else {
    reportingIdbPut(uploadId, loaded); // only cache a COMPLETE load
    migrateSnapshotToStorage(uploadId, loaded); // make next load a 1-file download
  }
  reportingUploadProgress(null);
  return loaded;
}

// One-time upgrade: take a snapshot that was stored as DB rows (slow paged
// load) and write it as a single gzipped Storage object + stamp storage_path,
// so every future load — on any device — is one fast download. Silently
// no-ops if the storage bucket isn't set up (run reporting_storage.sql).
async function migrateSnapshotToStorage(uploadId, rows) {
  try {
    const u = (state.reportingUploads || []).find(x => x.id === uploadId);
    if (!u || u.storage_path) return;                 // already migrated
    if (typeof CompressionStream === 'undefined') return;
    const blob = await new Response(new Blob([JSON.stringify(rows)]).stream()
      .pipeThrough(new CompressionStream('gzip'))).blob();
    const path = 'snapshots/' + uploadId + '.json.gz';
    const { error: stErr } = await supabase.storage.from('reporting').upload(path, blob, { contentType: 'application/gzip', upsert: true });
    if (stErr) return;                                // bucket missing — skip quietly
    const { error: upErr } = await supabase.from('reporting_uploads').update({ storage_path: path }).eq('id', uploadId);
    if (!upErr) { u.storage_path = path; console.info('[ridd] snapshot migrated to storage — future loads will be instant'); }
  } catch { /* best-effort */ }
}

function loadPersistedDemoState() {
  try {
    const raw = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed.mySales))     state.mySales     = parsed.mySales;
    if (Array.isArray(parsed.allSales))    state.allSales    = parsed.allSales;
    if (Array.isArray(parsed.competitions))state.competitions= parsed.competitions;
    if (Array.isArray(parsed.compRules))   state.compRules   = parsed.compRules;
    if (Array.isArray(parsed.compProgress))state.compProgress= parsed.compProgress;
    if (Array.isArray(parsed.allProfiles) && parsed.allProfiles.length) {
      state.allProfiles = parsed.allProfiles;
      // Sync state.profile from allProfiles so avatar / name / rate edits stick
      if (state.profile?.id) {
        const me = parsed.allProfiles.find(p => p.id === state.profile.id);
        if (me) Object.assign(state.profile, me);
      }
    }
    if (parsed.companyGoal) state.companyGoal = parsed.companyGoal;
    if (parsed.appSettings) state.appSettings = parsed.appSettings;
    if (Array.isArray(parsed.auditLog)) state.auditLog = parsed.auditLog;
    if (parsed.notifLastSeen) state.notifLastSeen = parsed.notifLastSeen;
    // Indicator CSV state is loaded separately by loadIndicatorState() at boot
    // (always runs, even outside DEMO). Don't double-load it here or a stale
    // demo-mode snapshot could overwrite the production CSV upload.
    if (parsed.backendReportUploadedAt) state.backendReportUploadedAt = parsed.backendReportUploadedAt;
    if (parsed.backendReportFileName) state.backendReportFileName = parsed.backendReportFileName;
    // Calendar v2: the schedule is fully user-built. Only keep persisted
    // shifts if the save was made by the v2 code (calendarReset marker). Older
    // snapshots had preset 7–3/9–5/8–4 slots seeded for you — we drop them so
    // the new blank canvas applies.
    if (parsed.calendarReset === true) {
      if (Array.isArray(parsed.shifts)) {
        // Migration: any shift missing department defaults to 'inside_sales'
        state.shifts = parsed.shifts.map(s => s.department ? s : { ...s, department: 'inside_sales' });
      }
      if (Array.isArray(parsed.shiftSwapRequests)) state.shiftSwapRequests = parsed.shiftSwapRequests;
    }
    if (parsed.calendarDepartment) state.calendarDepartment = parsed.calendarDepartment;
    if (parsed.calendarMinReps && typeof parsed.calendarMinReps === 'object') state.calendarMinReps = parsed.calendarMinReps;
    if (parsed.importMappings && typeof parsed.importMappings === 'object') state.importMappings = parsed.importMappings;
    if (Array.isArray(parsed.importHistory)) state.importHistory = parsed.importHistory;
    // Sources are seeded by loadDemoData(); persisted edits (add/hide) win
    // over the defaults so admin changes survive a refresh.
    if (Array.isArray(parsed.sources) && parsed.sources.length) state.sources = parsed.sources;
    // Reporting tab — restore metadata + config. Subscription rows aren't
    // persisted (too big for localStorage), so we keep the active-upload
    // pointer but expect a re-upload before charts have data again.
    if (Array.isArray(parsed.reportingUploads))       state.reportingUploads       = parsed.reportingUploads;
    if (Array.isArray(parsed.reportingServiceConfig)) state.reportingServiceConfig = parsed.reportingServiceConfig;
    if (Array.isArray(parsed.reportingCancelConfig))  state.reportingCancelConfig  = parsed.reportingCancelConfig;
    if (Array.isArray(parsed.reportingSourceConfig))  state.reportingSourceConfig  = parsed.reportingSourceConfig;
    if (parsed.reportingActiveUploadId)               state.reportingActiveUploadId = parsed.reportingActiveUploadId;
  } catch (err) {
    console.warn('[ridd] failed to load demo state', err);
  }
}

function saveDemoData() {
  // Indicator CSV uploads should persist in production too (not just demo).
  // Keep them in their own localStorage key so this isn't gated by DEMO.
  saveIndicatorState();
  if (!DEMO) return;

  // localStorage is ~5MB per origin. Two fields grow unbounded with use:
  //   auditLog       — every audit/notification event ever, 1 per action
  //   importHistory  — every CSV import receipt
  // Cap both before serializing so a long-running demo session doesn't
  // bloat the snapshot to the point of overflow.
  const AUDIT_CAP  = 500;
  const IMPORT_CAP = 50;
  const cappedAudit  = Array.isArray(state.auditLog)      ? state.auditLog.slice(-AUDIT_CAP)        : [];
  const cappedImport = Array.isArray(state.importHistory) ? state.importHistory.slice(-IMPORT_CAP) : [];

  const buildPayload = (overrides = {}) => JSON.stringify({
    mySales:      state.mySales,
    allSales:     state.allSales,
    competitions: state.competitions,
    compRules:    state.compRules,
    compProgress: state.compProgress,
    allProfiles:  state.allProfiles,
    auditLog:      cappedAudit,
    notifLastSeen: state.notifLastSeen,
    backendReportUploadedAt: state.backendReportUploadedAt,
    backendReportFileName: state.backendReportFileName,
    companyGoal:   state.companyGoal,
    appSettings:   state.appSettings,
    shifts:           state.shifts,
    shiftSwapRequests: state.shiftSwapRequests,
    calendarReset:    true,
    calendarDepartment: state.calendarDepartment,
    calendarMinReps:  state.calendarMinReps || {},
    importMappings:   state.importMappings,
    importHistory:    cappedImport,
    sources:          state.sources,
    // Reporting tab — only metadata + config persist (rows are too big
    // for localStorage). On reload, the active snapshot's row count is
    // restored but the rows themselves need a re-upload to appear.
    reportingUploads:        state.reportingUploads,
    reportingServiceConfig:  state.reportingServiceConfig,
    reportingCancelConfig:   state.reportingCancelConfig,
    reportingSourceConfig:   state.reportingSourceConfig,
    reportingActiveUploadId: state.reportingActiveUploadId,
    savedAt: new Date().toISOString(),
    ...overrides,
  });

  const isQuotaErr = (err) =>
    err && (err.name === 'QuotaExceededError' || err.code === 22 || /quota/i.test(err.message || ''));

  // Tiered save — drop the least valuable data first when over quota so
  // the user's real work (sales, sources, goals) still persists even on a
  // jammed origin. Toasts only fire on the final outcome so we don't
  // spam the screen with retry noise.
  const tiers = [
    { overrides: {}, label: null },
    { overrides: { auditLog: [] },                              label: 'Demo storage full — cleared old notifications.' },
    { overrides: { auditLog: [], importHistory: [] },           label: 'Demo storage full — cleared notifications + import history.' },
    { overrides: { auditLog: [], importHistory: [], shifts: [], shiftSwapRequests: [] },
      label: 'Demo storage full — cleared notifications, import history, and shifts.' },
  ];

  for (let i = 0; i < tiers.length; i++) {
    try {
      localStorage.setItem(DEMO_STORAGE_KEY, buildPayload(tiers[i].overrides));
      if (tiers[i].label) toast(tiers[i].label, 'warn');
      return;
    } catch (err) {
      if (!isQuotaErr(err)) {
        console.error('[ridd] SAVE FAILED:', err.name, err.message, err);
        toast('Save failed: ' + (err.message || err.name || 'unknown error'), 'error');
        return;
      }
      // Quota — fall through to next tier.
    }
  }

  // Even the leanest tier didn't fit. Tell the user what's likely the
  // cause (sales arrays — the only big thing we never drop) so they can
  // act on it instead of seeing a generic "save failed".
  const salesBytes = JSON.stringify(state.allSales || []).length + JSON.stringify(state.mySales || []).length;
  toast('Demo storage full — sales arrays are ~' + Math.round(salesBytes / 1024) + 'KB. Clear demo data in Settings → Admin if needed.', 'error');
}

function clearDemoData() {
  if (!DEMO) return;
  localStorage.removeItem(DEMO_STORAGE_KEY);
  location.reload();
}

// ──────────────────────────────────────────────────────────────────────────
// Audit log — records every status change so there's a paper trail
// ──────────────────────────────────────────────────────────────────────────
function logActivity(action, details = {}) {
  if (!state.auditLog) state.auditLog = [];
  state.auditLog.unshift({
    timestamp: new Date().toISOString(),
    action,
    sale_id: details.sale_id || null,
    customer_name: details.customer_name || null,
    old_status: details.old_status || null,
    new_status: details.new_status || null,
    by_user: state.profile?.full_name || 'system',
    rep_name: details.rep_name || null,
    detail: details.detail || null,
  });
  // Keep up to last 1000 entries — bigger history so the Backup search bar
  // can find old movements across many sales without losing context.
  if (state.auditLog.length > 1000) state.auditLog.length = 1000;
}

// ──────────────────────────────────────────────────────────────────────────
// SLACK INTEGRATION
// ──────────────────────────────────────────────────────────────────────────
// Two paths:
//   1. CHANNEL WEBHOOKS — "https://hooks.slack.com/services/..." URLs configured
//      in Settings → Slack → Channels. Slack incoming webhooks are CORS-enabled,
//      so the browser can POST to them directly. Used for: Sale Broadcast,
//      First Blood, Weekly Digest (when wired), Competition Updates.
//   2. DIRECT MESSAGES — require the bot token (xoxb-...) which CANNOT live in
//      the browser (CORS + token-leak). slack.sendDM POSTs to a Netlify Function
//      at /api/slack-paystub that holds the token server-side. In DEMO mode we
//      log the would-be sends to the activity trail and toast the count.
const slack = {
  // Promise-returning POST to a Slack incoming webhook. Slack returns "ok"
  // (200, body "ok") on success. Never throws — callers fan out and rely on
  // the returned { ok, error } shape.
  async postWebhook(url, payload) {
    if (!url) return { ok: false, error: 'No webhook URL configured' };
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const text = await res.text().catch(() => '');
      return res.ok
        ? { ok: true,  error: null }
        : { ok: false, error: 'HTTP ' + res.status + (text ? ' · ' + text.slice(0, 80) : '') };
    } catch (err) {
      return { ok: false, error: err?.message || String(err) };
    }
  },

  // Look up a configured channel's webhook URL by name (e.g. "#insidesales").
  webhookFor(channelName) {
    if (!channelName) return null;
    const ch = (state.appSettings?.slack_channels || []).find(c => c.name === channelName);
    return ch?.webhook || null;
  },

  // Post to a named channel — webhook lookup + POST + audit-log entry. Quietly
  // no-ops (with a console warn) if the channel has no webhook yet so a missing
  // config doesn't break the call site (e.g. logging a sale).
  async sendChannel(channelName, payload, kind) {
    const url = this.webhookFor(channelName);
    if (!url) {
      console.warn('[slack] no webhook for channel ' + channelName);
      return { ok: false, error: 'No webhook for ' + channelName };
    }
    const res = await this.postWebhook(url, payload);
    logActivity('slack_post', {
      new_status: kind || 'channel post',
      detail: channelName + (res.ok ? ' · sent' : ' · ' + res.error),
    });
    return res;
  },

  // Send a DM to one or more reps. In DEMO mode this is a stub: it logs the
  // intent to the activity trail and toasts a summary. In real mode it POSTs
  // to /api/slack-paystub which fans out via chat.postMessage server-side.
  async sendDM(repIds, payload, kind) {
    const ids = Array.isArray(repIds) ? repIds : [repIds];
    const profiles = (state.allProfiles || []).filter(p => ids.includes(p.id));
    // slack_member_id = the self-service column (⚙ My Settings); the old
    // slack_user_id column had NO write path — kept only as a fallback.
    const _sidOf = (p) => p.slack_member_id || p.slack_user_id || null;
    const withSlack = profiles.filter(p => _sidOf(p));
    const without = profiles.length - withSlack.length;

    if (DEMO) {
      withSlack.forEach(p => {
        logActivity('slack_dm_sent', {
          new_status: kind || 'dm',
          rep_name: p.full_name,
          detail: 'Demo · would DM ' + _sidOf(p),
        });
      });
      const sent = withSlack.length;
      if (sent > 0) {
        toast('Slack DM (demo): ' + sent + ' rep' + (sent === 1 ? '' : 's')
          + (without > 0 ? ' · ' + without + ' missing Slack ID' : ''),
          'success');
      } else if (without > 0) {
        toast('No reps have Slack User IDs configured', 'warn');
      }
      return { sent, skipped: without, errors: [] };
    }

    if (withSlack.length === 0) return { sent: 0, skipped: without, errors: [] };
    try {
      const res = await fetch('/api/slack-paystub', {
        method: 'POST',
        headers: await _apiAuthHeaders({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({
          recipients: withSlack.map(p => ({ slack_user_id: _sidOf(p), full_name: p.full_name })),
          payload,
          kind: kind || 'dm',
        }),
      });
      const data = await res.json().catch(() => ({}));
      withSlack.forEach(p => {
        logActivity('slack_dm_sent', {
          new_status: kind || 'dm',
          rep_name: p.full_name,
          detail: data.errors?.[_sidOf(p)] ? 'Failed · ' + data.errors[_sidOf(p)] : 'Sent',
        });
      });
      return {
        sent: data.sent || 0,
        skipped: (data.failed || 0) + without,
        errors: data.errors || {},
      };
    } catch (err) {
      toast('Slack relay failed: ' + (err.message || err), 'error');
      return { sent: 0, skipped: profiles.length, errors: { transport: err.message } };
    }
  },

  // ── Block Kit formatters ─────────────────────────────────────────────────
  formatPayStub(profile, period, summary, kind) {
    const moneyLine = (label, val) => '*' + label + ':* $' + Number(val || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const isBackend = kind === 'backend';
    return {
      text: (isBackend ? 'Backend pay run' : 'Pay run') + ' · ' + period.label,
      blocks: [
        { type: 'header', text: { type: 'plain_text', text: (isBackend ? '🏦 Backend Pay' : '💰 Pay Stub') + ' · ' + period.label } },
        { type: 'section', text: { type: 'mrkdwn', text:
          'Hi *' + profile.full_name + '* — your ' + (isBackend ? 'backend ' : '') + 'payroll just ran.\n\n' +
          (summary.salesPay != null ? moneyLine('Sales Pay', summary.salesPay) + '\n' : '') +
          (summary.belowPay != null && summary.below > 0 ? moneyLine('Below-Min Pay', summary.belowPay) + '\n' : '') +
          (summary.bonuses  != null ? moneyLine('Bonuses', summary.bonuses) + '\n' : '') +
          (summary.total    != null ? '\n' + moneyLine(isBackend ? 'Backend Total' : 'Total Pay', summary.total) : '')
        } },
        { type: 'context', elements: [
          { type: 'mrkdwn', text:
            (summary.serviced != null ? summary.serviced + ' serviced' : '') +
            (summary.below ? ' · ' + summary.below + ' below-min' : '') +
            ' · pay period ' + period.label
          },
        ] },
      ],
    };
  },

  formatSaleBroadcast(profile, sale) {
    const repName = profile?.full_name || 'A rep';
    const office  = (state.offices || []).find(o => o.id === sale.office_id)?.name || '';
    const service = (state.serviceTypes || []).find(t => t.id === sale.service_type_id)?.name || '';
    const acv     = Number(sale.revenue_amount || 0);
    const customer = sale.customer_name || 'a customer';
    return {
      text: repName + ' just sold ' + customer + ' — $' + acv.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 }) + ' ACV',
      blocks: [
        { type: 'section', text: { type: 'mrkdwn', text:
          '🎯 *' + repName + '* just closed *' + customer + '*' +
          (office ? ' · ' + office : '') +
          (service ? '\n_' + service + '_' : '') +
          '\n*ACV:* $' + acv.toLocaleString('en-US')
        } },
      ],
    };
  },

  formatFirstBlood(profile, settings) {
    const tmpl = settings?.message || '[Rep name] first blood today!';
    const text = tmpl.replace(/\[Rep name\]/gi, profile.full_name || 'A rep');
    const blocks = [
      { type: 'section', text: { type: 'mrkdwn', text: '🩸 *' + text + '*' } },
    ];
    if (settings?.image_url) {
      blocks.push({ type: 'image', image_url: settings.image_url, alt_text: 'First blood' });
    }
    return { text, blocks };
  },
};

// ──────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
// Double-click protection for every async button in the app (AUDIT.md,
// Sprint 2): when a click handler returns a promise the button is disabled
// and marked busy until it settles, so a second tap during a save / send /
// publish can't fire the request twice. Sync handlers are untouched.
const _withBusy = (node, fn) => function (ev) {
  if (node._busy) { ev.preventDefault(); ev.stopImmediatePropagation(); return; }
  let r;
  try { r = fn.call(this, ev); } catch (err) { throw err; }
  if (r && typeof r.then === 'function') {
    node._busy = true; const wasDisabled = node.disabled; node.disabled = true; node.setAttribute('aria-busy', 'true');
    const done = () => { node._busy = false; node.removeAttribute('aria-busy'); if (!wasDisabled && node.isConnected) node.disabled = false; };
    r.then(done, done);
  }
  return r;
};
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k === 'onclick' && typeof v === 'function' && (tag === 'button' || tag === 'a')) e.addEventListener('click', _withBusy(e, v));
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'html') e.innerHTML = v;
    else if (v !== false && v != null) e.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    e.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return e;
};

const fmt = {
  usd:   n => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })),
  usd0:  n => (n == null ? '—' : '$' + Number(n).toLocaleString('en-US', { maximumFractionDigits: 0 })),
  // Compact money for tight cells: $16.99M · $846.7K · $993 (per Isaac).
  usdShort: n => {
    if (n == null) return '—';
    const v = Number(n), a = Math.abs(v), sign = v < 0 ? '-' : '';
    if (a >= 1e6) return sign + '$' + (a / 1e6).toFixed(2) + 'M';
    if (a >= 1e4) return sign + '$' + (a / 1e3).toFixed(1) + 'K';
    return sign + '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 });
  },
  pct:   n => (n == null ? '—' : (Number(n) * 100).toFixed(2) + '%'),
  int:   n => (n == null ? '—' : Number(n).toLocaleString('en-US')),
  date:  s => (s ? new Date(s + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : '—'),
  dateShort: s => (s ? new Date(s + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '—'),
  // M/D/YY — same as dateShort but with a 2-digit year. Used in the Sales
  // table where year matters (sales can sit a quarter or two in flight).
  dateShortYear: s => (s ? new Date(s + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' }) : '—'),
  // Percent helpers where x is ALREADY a percentage (0–100), unlike fmt.pct.
  pct1:  x => (Number(x) || 0).toFixed(1) + '%',
  pct0:  x => (Number(x) || 0).toFixed(0) + '%',
  // "Sep 6" — accepts YYYY-MM-DD (local midnight) or a full ISO timestamp.
  dateMed: s => {
    if (!s) return '—';
    const d = typeof s === 'string' && s.length === 10 ? new Date(s + 'T00:00') : new Date(s);
    return isNaN(d) ? '—' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  },
  // +$1,234 / −$1,234 (unicode minus). money=false → +1,234 / −1,234.
  signed: (n, money) => {
    const v = Number(n) || 0, a = Math.abs(v);
    const body = money ? '$' + a.toLocaleString('en-US', { maximumFractionDigits: 0 }) : a.toLocaleString('en-US');
    return (v < 0 ? '−' : '+') + body;
  },
};
fmt.usd2 = fmt.usd;

// Canonical empty-state card ("No data yet", "Admins only.", "Loading…").
function emptyCard(msg, extra) {
  return el('div', { class: 'card p-10 text-center text-sm text-muted-' }, msg, extra || null);
}

function toast(msg, type = 'info') {
  // Card-token skin (legacy bg-eerie3 / bg-lime palette retired).
  const colors = {
    info:    { background: 'var(--card-2)', color: 'var(--text)', borderColor: 'var(--border-2)' },
    success: { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' },
    error:   { background: '#DC2626', color: '#fff', borderColor: '#DC2626' },
    warn:    { background: '#A9441F', color: '#fff', borderColor: '#A9441F' },
  };
  const t = el('div', {
    class: 'pointer-events-auto fade-in rounded-xl border px-4 py-3 shadow-lg text-sm font-semibold',
    style: Object.assign({ maxWidth: 'min(360px, calc(100vw - 2rem))' }, colors[type] || colors.info),
  }, msg);
  $('#toasts').append(t);
  setTimeout(() => { t.style.opacity = '0'; t.style.transition = 'opacity .3s'; }, 3200);
  setTimeout(() => t.remove(), 3600);
}

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
  reportingDateRange: 'all',       // 'all' | 'ytd' | 'last_12_months' | 'last_year' | 'custom'
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

// ──────────────────────────────────────────────────────────────────────────
// Boot sequence
// ──────────────────────────────────────────────────────────────────────────
async function boot() {
  // #history is a legacy hash that now routes to Sales tab + History pill.
  // Apply the side-effect (queue filter) anywhere we honor a hash.
  const applyHash = () => {
    const v = HASH_MAP[location.hash] || ((window.RIDD_MODULES || []).some(m => '#' + m.id === location.hash) ? location.hash.slice(1) : null);
    if (!v) return null;
    if (location.hash === '#history') state._salesQueueFilter = 'history';
    return v;
  };

  // Always rehydrate the indicator CSV upload (state.indicatorsData,
  // raw sales, snapshots, etc.) regardless of demo mode. Without this,
  // a refresh wiped every uploaded CSV in production — which broke
  // week-over-week comparisons between uploads.
  loadIndicatorState();

  if (DEMO) {
    loadDemoData();
    const hv = applyHash();
    if (hv) state.view = hv;
    else if (_applyResume()) { /* resume within window */ }
    mountApp();
    if (state._resumeScroll) { const y = state._resumeScroll; state._resumeScroll = 0; setTimeout(() => window.scrollTo(0, y), 400); }
    window.addEventListener('hashchange', () => {
      const v = applyHash();
      if (v && v !== state.view) { state.view = v; mountApp(); }
      else if (v === state.view && location.hash === '#history') mountApp();
    });
    return;
  }
  if (!supabase) {
    mountConfigMissing();
    return;
  }
  // Capture the URL synchronously BEFORE `supabase.auth.getSession()`
  // gets a chance to consume the fragment. The SDK strips recovery
  // tokens out of `location.hash` once it processes them, so any later
  // check would miss it.
  //
  //   Legacy implicit flow: `#access_token=...&type=recovery&...`
  //   Modern PKCE flow:     `?code=...` (no `type=recovery` hint in URL —
  //                         we rely on the PASSWORD_RECOVERY auth event
  //                         registered below to catch this case)
  const recoveryFromUrl = (location.hash || '').includes('type=recovery');
  // A refresh mid-recovery used to skip the form entirely (the recovery
  // session signs the user in), letting reps land in the app WITHOUT ever
  // setting a password. This tab-scoped flag pins the form until the save
  // actually succeeds.
  let recoveryPending = false;
  try { recoveryPending = sessionStorage.getItem('ridd_recovery_pending') === '1'; } catch { /* private mode */ }

  // Track whether we've shown the recovery form so a follow-up
  // SIGNED_IN event (Supabase fires both during PKCE recovery) doesn't
  // bounce the user out of the password-update screen back into the app.
  let recoveryShown = false;
  const showRecovery = () => {
    if (recoveryShown) return;
    recoveryShown = true;
    try { sessionStorage.setItem('ridd_recovery_pending', '1'); } catch { /* private mode */ }
    mountAuth({ mode: 'recover' });
  };

  // Listener is registered BEFORE `getSession()` so PASSWORD_RECOVERY
  // events that fire during the SDK's initial URL-detection are caught.
  // Previous version registered after the await and missed the event
  // entirely — that's why reset links just dropped users into the app.
  supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') { showRecovery(); return; }
    // recoveryPending: a refresh mid-recovery re-fires INITIAL_SESSION with
    // the recovery session — without this guard the listener's async
    // loadAndRender() would mount the app OVER the pinned set-password form.
    if (recoveryShown || (recoveryPending && session)) return; // stay on the recovery form
    // TOKEN_REFRESHED fires ~hourly and on tab-focus; USER_UPDATED after
    // profile edits. The fresh session is already swapped into state above —
    // reloading here yanked users to the splash + reset their tab mid-read
    // (THE "app feels glitchy" report). Never re-splash a working session.
    if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') return;
    if (session) {
      if (state.profile) return;   // already hydrated — nothing to do
      loadAndRender();
    } else mountAuth();
  });

  if (recoveryFromUrl) {
    showRecovery();
    return;
  }

  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;
  if (recoveryShown) return;
  if (!session) {
    // No session → any lingering recovery flag is stale (link expired /
    // signed out). Clear it so a later normal sign-in isn't hijacked.
    recoveryPending = false;
    try { sessionStorage.removeItem('ridd_recovery_pending'); } catch { /* ignore */ }
    mountAuth();
    return;
  }
  if (recoveryPending) {
    // Refresh mid-recovery: keep them on the set-password form instead of
    // silently dropping them into the app with no password set.
    showRecovery();
    return;
  }
  // 30-DAY RE-AUTH — light security hygiene: sessions otherwise refresh
  // forever. Once a month the app asks for the password again (iOS keychain
  // autofill makes it a two-tap). Clock starts at each successful sign-in.
  if (session) {
    try {
      const REAUTH_MS = 30 * 86400000;
      const la = Number(localStorage.getItem('ridd_last_auth_v1') || 0);
      if (!la) localStorage.setItem('ridd_last_auth_v1', String(Date.now()));   // existing sessions: start the clock now
      else if (Date.now() - la > REAUTH_MS) {
        localStorage.removeItem('ridd_last_auth_v1');
        await supabase.auth.signOut();
        mountAuth();
        try { toast('Quick security check — please sign in again.', 'info'); } catch { /* pre-toast */ }
        return;
      }
    } catch { /* private mode — skip */ }
  }
  const hv2 = applyHash();
  if (hv2) { state.view = hv2; state._navChosen = true; }
  else if (_applyResume()) { state._navChosen = true; /* re-opened within the window → land on the last tab */ }
  await loadAndRender();
  // Put them back at the scroll position they left (best-effort — data
  // sections finish loading async, so a slightly different height is fine).
  if (state._resumeScroll) { const y = state._resumeScroll; state._resumeScroll = 0; setTimeout(() => window.scrollTo(0, y), 400); }
  // Back onto the TV board after a version auto-reload (the board set the flag).
  try {
    if (sessionStorage.getItem('ridd_reopen_tv') === '1') {
      sessionStorage.removeItem('ridd_reopen_tv');
      if (typeof openTvBoard === 'function' && state.profile) setTimeout(() => { try { openTvBoard(); } catch (e) { /* board optional */ } }, 600);
    }
  } catch { /* ignore */ }
  // Post-reload confirmation from the password-save handoff.
  try {
    if (sessionStorage.getItem('ridd_pw_saved') === '1') {
      sessionStorage.removeItem('ridd_pw_saved');
      toast("Password updated — you're all set.", 'success');
    }
  } catch { /* ignore */ }
  window.addEventListener('hashchange', () => {
    const v = applyHash();
    if (v && v !== state.view) { state.view = v; mountApp(); }
    else if (v === state.view && location.hash === '#history') mountApp();
  });
}

// ──────────────────────────────────────────────────────────────────────────
// DEMO MODE — fake data so the UI can be explored without Supabase
// ──────────────────────────────────────────────────────────────────────────
function loadDemoData() {
  state.session = { user: { id: 'demo-1', email: 'isaac@ridd.com' } };
  state.offices = [
    { id: 1, name: 'Atlanta' },
    { id: 2, name: 'Charleston' },
    { id: 3, name: 'Destin' },
    { id: 4, name: 'Detroit' },
    { id: 5, name: 'Myrtle Beach' },
    { id: 6, name: 'Raleigh' },
    { id: 7, name: 'Salt Lake' },
    { id: 8, name: 'Virginia Beach' },
  ];
  // Real RIDD service types (from SALES sheet column E validation)
  const SERVICE_TYPE_NAMES = [
    'Carpenter Bee 12','Carpenter Bee 4','Carpenter Bee 6',
    'German Roach 12','German Roach 4','German Roach 6','German Roach Mole 4',
    'Interior Flea 12','Interior Flea 4','Interior Flea 6',
    'Mole 12','Mole 4','Mole 6',
    'Mole Mosquito 12','Mole Mosquito 4','Mole Mosquito 6','Mole Mosquito 6 Seasonal',
    'Mole Mosquito Rodent 4','Mole Mosquito Snake 6',
    'Mole Rodent 4','Mole Rodent 6',
    'Mole Snake 4','Mole Snake 6',
    'Mosquito 12','Mosquito 4','Mosquito 6',
    'Mosquito Rodent 12','Mosquito Rodent 4','Mosquito Rodent 6',
    'Mosquito Rodent 6 Seasonal','Mosquito Rodent Snake 6 Seasonal',
    'Mosquito Snake 4','Mosquito Snake 6',
    'One Time German Roach','One Time Interior Flea','One Time Mosquito',
    'One Time Pest Control','One Time Rodent','One Time Termite Inspection',
    'One Time Vehicle Inpsection',
    'Pest 12','Pest 4','Pest 4 - Spanish','Pest 6','Pest 6 - Spanish',
    'Pest Carpenter Bee 4','Pest Carpenter Bee 6','Pest Carpenter Bee Mole 4',
    'Pest Carpenter Bee Mole 6','Pest Carpenter Bee Mosquito 4 Seasonal',
    'Pest German Roach 12','Pest German Roach 4','Pest German Roach 6',
    'Pest German Roach Mole 4','Pest German Roach Mole 6',
    'Pest German Roach Mole Mosquito 4','Pest German Roach Mole Mosquito 6',
    'Pest German Roach Mole Mosquito Snake 6',
    'Pest German Roach Mole Rodent 4','Pest German Roach Mole Rodent 6',
    'Pest German Roach Mole Snake 4','Pest German Roach Mole Snake Rodent 4',
    'Pest German Roach Mosquito 4','Pest German Roach Mosquito 4 Seasonal',
    'Pest German Roach Mosquito 6','Pest German Roach Mosquito Snake 4',
    'Pest German Roach Rodent 12','Pest German Roach Rodent 4',
    'Pest German Roach Rodent 6','Pest German Roach Rodent Snake 6',
    'Pest German Roach Snake 4','Pest German Roach Snake 6',
    'Pest Interior 4','Pest Interior 6',
    'Pest Interior Flea 4','Pest Interior Flea Mole 4','Pest Interior Flea Mosquito 4',
    'Pest Mole 12','Pest Mole 4','Pest Mole 6',
    'Pest Mole Mosquito 4','Pest Mole Mosquito 4 Seasonal',
    'Pest Mole Mosquito 6','Pest Mole Mosquito 6 Seasonal',
    'Pest Mole Mosquito Snake 12','Pest Mole Mosquito Snake 4',
    'Pest Mole Mosquito Snake 6','Pest Mole Mosquito Snake 6 Seasonal',
    'Pest Mole Rodent 4','Pest Mole Rodent 6','Pest Mole Rodent Snake 6',
    'Pest Mole Snake 4','Pest Mole Snake 6','Pest Mole Snake Rodent 4',
    'Pest Mosquito 12','Pest Mosquito 4','Pest Mosquito 4 - Spanish',
    'Pest Mosquito 4 Seasonal','Pest Mosquito 6','Pest Mosquito 6 - Spanish',
    'Pest Mosquito 6 Seasonal','Pest Mosquito 6 Seasonal - Spanish',
    'Pest Mosquito Mole 12',
    'Pest Mosquito Snake 4','Pest Mosquito Snake 4 Seasonal',
    'Pest Mosquito Snake 6','Pest Mosquito Snake 6 Seasonal',
    'Pest Rodent 12','Pest Rodent 4','Pest Rodent 6',
    'Pest Rodent Mole 4','Pest Rodent Snake 4','Pest Rodent Snake 6',
    'Pest Snake 12','Pest Snake 4','Pest Snake 6',
    'RIDD Package 12','RIDD Package 4','RIDD Package 4 - Spanish',
    'RIDD Package 4 Seasonal','RIDD Package 6','RIDD Package 6 - Spanish',
    'RIDD Package 6 Seasonal',
    'RIDD Package Carpenter Bee 4','RIDD Package Carpenter Bee 6 Seasonal',
    'RIDD Package Carpenter Bee Mole 6','RIDD Package Carpenter Bee Mole 6 Seasonal',
    'RIDD Package Flea Mole Snake 6',
    'RIDD Package German Roach 12','RIDD Package German Roach 4',
    'RIDD Package German Roach 4 Seasonal','RIDD Package German Roach 6',
    'RIDD Package German Roach 6 Seasonal',
    'RIDD Package German Roach Interior Flea 4','RIDD Package German Roach Interior Flea 6',
    'RIDD Package German Roach Mole 4','RIDD Package German Roach Mole 6',
    'RIDD Package German Roach Mole 6 Seasonal',
    'RIDD Package German Roach Snake 12','RIDD Package German Roach Snake 4',
    'RIDD Package German Roach Snake 6','RIDD Package German Roach Snake 6 Seasonal',
    'RIDD Package Interior Flea 4','RIDD Package Interior Flea 6',
    'RIDD Package Interior Flea 6 Seasonal',
    'RIDD Package Interior Flea Mole 6',
    'RIDD Package Interior Flea Snake 6 Seasonal',
    'RIDD Package Mole 12','RIDD Package Mole 4','RIDD Package Mole 6',
    'RIDD Package Mole 6 Seasonal',
    'RIDD Package Mole Snake 12','RIDD Package Mole Snake 4',
    'RIDD Package Mole Snake 6','RIDD Package Mole Snake 6 Seasonal',
    'RIDD Package Snake 12','RIDD Package Snake 4','RIDD Package Snake 6',
    'RIDD Package Snake 6 Seasonal',
    'Rodent 12','Rodent 4','Rodent 6',
    'Rodent Snake 4','Rodent Snake 6',
    'Sentricon - Retreat',
    'Snake 12','Snake 4','Snake 6',
    'Solo Seasonal Mosquito',
  ];
  state.serviceTypes = SERVICE_TYPE_NAMES.map((name, i) => ({ id: i + 1, name }));

  // Real RIDD sources (from SALES sheet column G validation)
  state.sources = [
    { id: 1,  name: 'Angi',                         is_renewal: false },
    { id: 2,  name: 'Baton',                        is_renewal: false },
    { id: 3,  name: 'Bing Ads',                     is_renewal: false },
    { id: 4,  name: 'eLocal',                       is_renewal: false },
    { id: 5,  name: 'Facebook',                     is_renewal: false },
    { id: 6,  name: 'Google Ads',                   is_renewal: false },
    { id: 7,  name: 'Google Local Services',        is_renewal: false },
    { id: 8,  name: 'Inside Sale',                  is_renewal: false },
    { id: 9,  name: 'Pest Net',                     is_renewal: false },
    { id: 10, name: 'Referral',                     is_renewal: false },
    { id: 11, name: 'Service Direct',               is_renewal: false },
    { id: 12, name: 'Website',                      is_renewal: false },
    { id: 13, name: 'Yelp',                         is_renewal: false },
    { id: 14, name: 'Renewal - Inbound',            is_renewal: true  },
    { id: 15, name: 'Renewal - Loyalty',            is_renewal: true  },
    { id: 16, name: 'Renewal - Outbound',           is_renewal: true  },
    { id: 17, name: 'Renewal - Service Pro Upsell', is_renewal: true  },
  ];

  // Real RIDD contract types (Commercial + Paid in Full are checkbox modifiers, not contract types)
  state.contractTypes = DEFAULT_CONTRACT_TYPES.map(c => ({ ...c }));
  // Avatars default to null — initials show until an admin uploads a photo.
  state.profile = {
    id: 'demo-1', full_name: 'Isaac Hunter', email: 'isaac@ridd.com', role: 'admin', office_id: 3, initials: 'IH',
    avatar_url: null,
    upfront_commission_rate: 0.07, below_min_commission_rate: 0.035, close_rate_target: 0.50,
    annual_revenue_goal: 750000,
    // Rep type drives which Upfront-Pay rows show on the Pay tab. Loyalty
    // reps see Loyalty Pay + Loyalty Royalty; sales reps see Golden Phone.
    rep_type: 'sales_rep',
    // Manual per-rep pay additives, set in admin Users → flow into the
    // upfront stub each pay period. Default 0.
    golden_phone_amount: 0,
    loyalty_royalty_amount: 0,
    loyalty_pay_amount: 0,
    other_pay_amount: 0,
  };
  state.companyGoal = { amount: 6000000, period: 'year' };

  const today = new Date();
  const d = (offset) => { const x = new Date(today); x.setDate(x.getDate() + offset); return x.toISOString().slice(0, 10); };
  // Mk helper — makes a sale row with sensible defaults.
  // Also generates a created_at timestamp so the TIME column and badges work.
  const mkTime = (sold, hour, min) => {
    const x = new Date(sold + 'T00:00');
    x.setHours(hour, min, 0, 0);
    return x.toISOString();
  };
  let _mkSeq = 0;
  const mk = (overrides) => {
    _mkSeq += 1;
    const sold = overrides.sold_date || d(0);
    const hour = 8 + (_mkSeq % 10);
    const min  = (_mkSeq * 7) % 60;
    return {
      rep_id: 'demo-1', office_id: 3, service_type_id: 1, source_id: 1,
      contract_months: 12, initial_amount: 0, monthly_amount: 0, revenue_amount: 0,
      sold_date: sold, audit_status: 'serviced', notes: '',
      created_at: mkTime(sold, hour, min),
      ...overrides,
    };
  };

  // ── Sales: empty by default. Log sales through the "+ New Sale" modal
  //    to walk through the full journey (log → audit → stage → payroll). ──
  state.mySales  = [];
  state.allSales = [];
  void mk; void mkTime;

  // (persistence load moved to end of loadDemoData, after all hardcoded defaults are set)

  state.competitions = [
    { id: 1, name: 'January RIDDTOPIA', category: 'inside_sales', type: 'bingo', start_date: d(-14), end_date: d(14), prize_text: 'Blackout: 150,000 RC', description: '2-week bingo, all sales must be auditable.', is_active: true, min_qualifying_revenue: null },
    { id: 2, name: 'Golden Phone',      category: 'inside_sales', type: 'royalty', start_date: d(-90), end_date: d(275), prize_text: '$300/mo × 12',          description: 'Top inside sales rep, minimum $650k serviced revenue to qualify.', is_active: true, min_qualifying_revenue: 650000 },
    { id: 3, name: 'Loyalty Royalty',   category: 'loyalty',      type: 'royalty', start_date: d(-90), end_date: d(275), prize_text: '$300/mo × 12',          description: '$1M in Saved ARR minimum to qualify.', is_active: true, min_qualifying_revenue: 1000000 },
  ];
  state.compRules = [
    // RIDDTOPIA bingo squares (5 col × 4 row)
    { id: 1,  competition_id: 1, label: '5 Accounts Sold In A Day',   metric: 'count',       operator: '>=', threshold: 5,   window: 'day',   bingo_row: 0, bingo_col: 0, filters: {} },
    { id: 2,  competition_id: 1, label: '4 Multi-Years In A Day',     metric: 'count',       operator: '>=', threshold: 4,   window: 'day',   bingo_row: 0, bingo_col: 1, filters: {} },
    { id: 3,  competition_id: 1, label: '1 Pest 6 Sold',              metric: 'count',       operator: '>=', threshold: 1,   window: 'week',  bingo_row: 0, bingo_col: 2, filters: { service_type_id: [2] } },
    { id: 4,  competition_id: 1, label: '1 Contract > $1200',         metric: 'count',       operator: '>=', threshold: 1,   window: 'week',  bingo_row: 0, bingo_col: 3, filters: { min_revenue: 1200 } },
    { id: 5,  competition_id: 1, label: '20 Subs On The Week',        metric: 'count',       operator: '>=', threshold: 20,  window: 'week',  bingo_row: 0, bingo_col: 4, filters: {} },

    { id: 6,  competition_id: 1, label: '30 Accounts On The Week',    metric: 'count',       operator: '>=', threshold: 30,  window: 'week',  bingo_row: 1, bingo_col: 0, filters: {} },
    { id: 7,  competition_id: 1, label: '3 One-Time Svcs On The Week',metric: 'count',       operator: '>=', threshold: 3,   window: 'week',  bingo_row: 1, bingo_col: 1, filters: {} },
    { id: 8,  competition_id: 1, label: '1 PCI Initial < $189',       metric: 'count',       operator: '>=', threshold: 1,   window: 'week',  bingo_row: 1, bingo_col: 2, filters: {} },
    { id: 9,  competition_id: 1, label: '$15,000 Revenue On Week',    metric: 'sum_revenue', operator: '>=', threshold: 15000, window: 'week', bingo_row: 1, bingo_col: 3, filters: {} },
    { id: 10, competition_id: 1, label: 'Avg Initial > $149',         metric: 'avg_initial', operator: '>=', threshold: 149, window: 'week',  bingo_row: 1, bingo_col: 4, filters: {} },

    { id: 11, competition_id: 1, label: '2 RIDD Packages/Week',       metric: 'count',       operator: '>=', threshold: 2,   window: 'week',  bingo_row: 2, bingo_col: 0, filters: {} },
    { id: 12, competition_id: 1, label: '1 Inbound Resign',           metric: 'count',       operator: '>=', threshold: 1,   window: 'week',  bingo_row: 2, bingo_col: 1, filters: {} },
    { id: 13, competition_id: 1, label: '2 Follow Up Closes',         metric: 'count',       operator: '>=', threshold: 2,   window: 'week',  bingo_row: 2, bingo_col: 2, filters: {} },
    { id: 14, competition_id: 1, label: '2 Rodent Accounts',          metric: 'count',       operator: '>=', threshold: 2,   window: 'week',  bingo_row: 2, bingo_col: 3, filters: { service_type_id: [5] } },
    { id: 15, competition_id: 1, label: '2 Office/D2D Upsells',       metric: 'count',       operator: '>=', threshold: 2,   window: 'week',  bingo_row: 2, bingo_col: 4, filters: {} },

    { id: 16, competition_id: 1, label: '5 Accounts In A Day',        metric: 'count',       operator: '>=', threshold: 5,   window: 'day',   bingo_row: 3, bingo_col: 0, filters: {} },
    { id: 17, competition_id: 1, label: '4 Multi-Years On Week',      metric: 'count',       operator: '>=', threshold: 4,   window: 'week',  bingo_row: 3, bingo_col: 1, filters: {} },
    { id: 18, competition_id: 1, label: '20 Subs Sold On Week',       metric: 'count',       operator: '>=', threshold: 20,  window: 'week',  bingo_row: 3, bingo_col: 2, filters: {} },
    { id: 19, competition_id: 1, label: '1 PCI Initial < $189',       metric: 'count',       operator: '>=', threshold: 1,   window: 'week',  bingo_row: 3, bingo_col: 3, filters: {} },
    { id: 20, competition_id: 1, label: '2 Rodent On The Week',       metric: 'count',       operator: '>=', threshold: 2,   window: 'week',  bingo_row: 3, bingo_col: 4, filters: { service_type_id: [5] } },

    // Golden Phone royalty rule
    { id: 21, competition_id: 2, label: '$650,000 in Serviced Revenue', metric: 'sum_revenue', operator: '>=', threshold: 650000, window: 'competition', bingo_row: null, bingo_col: null, filters: {} },
    // Loyalty Royalty
    { id: 22, competition_id: 3, label: '$1,000,000 in Saved ARR',      metric: 'sum_revenue', operator: '>=', threshold: 1000000, window: 'competition', bingo_row: null, bingo_col: null, filters: {} },
  ];

  // Evaluate rules against the demo sales to populate progress
  state.compProgress = [];
  for (const comp of state.competitions) {
    const rules = state.compRules.filter(r => r.competition_id === comp.id);
    for (const rule of rules) {
      const val = evaluateRule(rule, comp, state.mySales);
      state.compProgress.push({
        id: state.compProgress.length + 1,
        competition_id: comp.id, rule_id: rule.id, rep_id: 'demo-1',
        current_value: val, met: compare(val, rule.operator, Number(rule.threshold)),
        last_computed_at: new Date().toISOString(),
      });
    }
  }

  // Canonical list of all reps (profiles). Leaderboard is computed from sales.
  state.allProfiles = [
    { ...state.profile, slack_user_id: 'U01AB2CD3EF', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.50 },
    { id: 'demo-2', full_name: 'Pere LeSueur',   email: 'pere@ridd.com',   role: 'rep', office_id: 3, initials: 'PL', avatar_url: null,   annual_revenue_goal: 500000, slack_user_id: 'U02PQ0PK95F', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.50 },
    { id: 'demo-3', full_name: 'Connor Bird',    email: 'connor@ridd.com', role: 'rep', office_id: 8, initials: 'CB', avatar_url: null, annual_revenue_goal: 500000, slack_user_id: 'U09CJEY1VD4', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.50 },
    { id: 'demo-4', full_name: 'Elijah Norman',  email: 'elijah@ridd.com', role: 'rep', office_id: 8, initials: 'EN', avatar_url: null, annual_revenue_goal: 500000, slack_user_id: 'U0ALYGD8W0P', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.50 },
    { id: 'demo-5', full_name: 'Sean Hernandez', email: 'sean@ridd.com',   role: 'rep', office_id: 1, initials: 'SH', avatar_url: null,   annual_revenue_goal: 500000, slack_user_id: 'U078915SF0W', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.50 },
    { id: 'demo-6', full_name: 'Drew Sauer',     email: 'drew@ridd.com',   role: 'rep', office_id: 2, initials: 'DS', avatar_url: null,   annual_revenue_goal: 500000, slack_user_id: 'U09CJEVKFHC', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.50 },
    { id: 'demo-7', full_name: 'Andrew Peterson',email: 'andrew@ridd.com', role: 'rep', office_id: 4, initials: 'AP', avatar_url: null, annual_revenue_goal: 500000, slack_user_id: 'U0711E707KP', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.50 },
    { id: 'demo-8', full_name: 'Jackson Brooks', email: 'jackson@ridd.com',role: 'rep', office_id: 5, initials: 'JB', avatar_url: null,annual_revenue_goal: 500000, slack_user_id: 'U09A381G8A2', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.50 },
  ];
  // App-wide settings that only admins see (stored as state — would be app_settings rows in prod)
  state.appSettings = state.appSettings || { slack_bot_token: '' };
  // Legacy shape — computed on the fly now; kept for pre-rewrite callers
  state.leaderboard = [];

  // ── Calendar starts empty ─────────────────────────────────────────────────
  //    No preset slots. Admins build the schedule via the "+ New shift" modal
  //    (click any empty day column, or the toolbar button). Each shift stores
  //    its own canonical times in slot_start/slot_end; state.shifts entries
  //    with the same (date, slot_start, slot_end) render as a single block.
  state.shifts = [];
  state.shiftSwapRequests = [];

  // ── Load persisted demo state LAST so it overwrites the hardcoded defaults above.
  //    This is what keeps avatars, settings, sales, etc. alive across reloads.
  //    Pass ?demo&reset to clear everything and start fresh. ──
  if (new URLSearchParams(location.search).has('reset')) {
    localStorage.removeItem(DEMO_STORAGE_KEY);
  } else {
    loadPersistedDemoState();
  }

  // Backfill revenue_amount on persisted sales using the canonical formula
  // (initial + monthly * 11 for subscriptions; initial + numServices * amt
  // for PPS). Older demo data may have been saved with the prior contract-
  // length-based formula and would otherwise show stale revenue figures.
  const recomputeRevenue = (s) => {
    if (s.pay_per_service) {
      return Number(s.initial_amount || 0) + Number(s.num_services || 0) * Number(s.monthly_amount || 0);
    }
    return Number(s.initial_amount || 0) + Number(s.monthly_amount || 0) * 11;
  };
  for (const list of [state.mySales, state.allSales]) {
    if (!Array.isArray(list)) continue;
    list.forEach(s => { s.revenue_amount = recomputeRevenue(s); });
  }
}

let _loadAndRenderInFlight = false;
async function loadAndRender() {
  // Supabase fires an INITIAL_SESSION event through onAuthStateChange AND we
  // also call this from the explicit getSession() path on boot — without this
  // guard both fire, giving two full loading→render cycles (the refresh
  // flicker). The in-flight flag collapses the duplicate into one render.
  if (_loadAndRenderInFlight) return;
  _loadAndRenderInFlight = true;
  mountLoading();
  try {
    await loadProfile();
    // Lookups and the main data pull are independent — run them in parallel
    // (they used to be two sequential network stages on every boot).
    await Promise.all([loadLookups(), loadData()]);
    // FRESHNESS ON LOGIN (per Isaac — Pere landed on week-old data): kick a
    // FORCED cloud check right now instead of waiting for the poll. It's a
    // conditional (ETag) request, so it costs nothing when nothing new
    // landed; when the local copy is stale it re-renders as soon as the
    // fresh snapshot arrives.
    try { refreshIndicatorsFromCloud(true); } catch (e) { /* the poll retries */ }
    try { loadUserPrefs(); } catch (e) { /* per-device fallback */ }
    // Default landing by REP TYPE (no explicit hash/resume): office staff →
    // Inside Sales dashboard, technicians → Technicians, D2D reps → D2D
    // Sales, auditors → Sales queue. Admins keep the dashboard.
    if (!state._navChosen) state.view = defaultViewFor(state.profile);
    usagePing('login');
    mountApp();
    // Weekly recap for reps — after the app paints. D2D reps whose dataset
    // arrives via the async cloud pull get a second chance from that path.
    setTimeout(() => { try { maybeShowWeeklyRecap(); } catch { /* ignore */ } }, 800);
  } catch (err) {
    console.error(err);
    mountError(err);
  } finally {
    _loadAndRenderInFlight = false;
  }
}

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
const _calFp = () => { try { return JSON.stringify([state.shifts, state.shiftSwapRequests, state.calendarMinReps || {}]); } catch { return ''; } };
async function loadCalendarFromCloud() {
  if (DEMO || !supabase || !state.profile) return;
  try {
    const { data, error } = await supabase.from('calendar_store').select('data').eq('id', 1).maybeSingle();
    if (error) { console.warn('[ridd] calendar cloud load skipped (run calendar_store.sql?)', error.message); return; }
    const d = (data && data.data) || null;
    if (d && Array.isArray(d.shifts)) state.shifts = d.shifts;
    if (d && Array.isArray(d.swaps))  state.shiftSwapRequests = d.swaps;
    if (d && d.minReps && typeof d.minReps === 'object') state.calendarMinReps = d.minReps;
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
        data: { shifts: state.shifts || [], swaps: state.shiftSwapRequests || [], minReps: state.calendarMinReps || {} },
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
function setViewAsProfile(profile) {
  const real = state._realProfile || state.profile;
  if (!real || !isAdminRole(real.role) || !profile || !profile.id) return;
  try {
    sessionStorage.setItem(VIEW_AS_PROFILE_KEY, profile.id);
    sessionStorage.setItem(VIEW_AS_KEY, profile.role || 'rep_sales');
    sessionStorage.setItem('ridd_view_as_return', state.view || 'admin');
  } catch { /* private mode */ }
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
  const [salesRes, lb, gh] = await Promise.all([
    supabase.from('sales').select('*').order('sold_date', { ascending: false }),
    supabase.from('leaderboard').select('*'),
    loadUnloggedSales(),
  ]);
  if (salesRes.data) {
    _splitSalesRows(salesRes.data);
  }
  if (lb.data) state.leaderboard = lb.data;
  if (gh) state.unloggedSales = gh;
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
  loadAutologSwitch().then(() => { if (state._autologCache && state._autologCache.upsells === 'auto') mountApp(); });
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
// Mounts — top-level views
// ──────────────────────────────────────────────────────────────────────────
function mount(view) {
  const app = $('#app');
  app.innerHTML = '';
  app.append(view);
}

function mountConfigMissing() {
  mount(el('div', { class: 'min-h-screen flex items-center justify-center p-6' },
    el('div', { class: 'card p-8 max-w-xl text-center' },
      el('div', { class: 'text-4xl font-black tracking-tight mb-1', style: { color: 'var(--accent)' } }, 'RIDD'),
      el('div', { class: 'text-xs text-muted- tracking-widest mb-6' }, 'SALES PLATFORM'),
      el('h1', { class: 'text-xl font-semibold mb-3' }, 'Configuration needed'),
      el('p', { class: 'text-muted- text-sm mb-4' },
        'Open ', el('code', { style: { color: 'var(--accent)' } }, 'index.html'),
        ' and paste your Supabase publishable key into the ',
        el('code', { style: { color: 'var(--accent)' } }, 'RIDD_CONFIG'), ' block at the top of the file.'),
      el('p', { class: 'text-muted- text-xs mb-6' },
        'Supabase Dashboard → Settings → API Keys → "Publishable and secret API keys" → Create new API keys'),
      el('div', { class: 'pt-4 border-t', style: { borderColor: 'var(--border)' } },
        el('p', { class: 'text-xs text-muted- mb-3' }, 'Or explore the UI with mock data:'),
        el('a', {
          href: '?demo',
          class: 'inline-block px-5 py-2.5 rounded-xl font-semibold text-sm transition hover:brightness-95', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        }, 'View demo →'),
      ),
    )));
}

function mountLoading() {
  // ONE loading screen (per Isaac): if the static HTML boot splash (RIDD ·
  // Service Above All) is still on screen, leave it alone — replacing it
  // with a different "Loading…" spinner read as two loading screens. When
  // the splash is already gone (mid-session re-auth), render the SAME
  // splash markup so the brand screen is the only loader anywhere.
  if (document.getElementById('splashMark')) { _armSplashWatchdog(); return; }
  let logoImg = null;
  try {
    const logo = localStorage.getItem('ridd-spin-logo-v1') || '';
    if (/^data:image\//.test(logo)) logoImg = el('img', { src: logo, alt: 'RIDD', style: { height: '64px', display: 'block' } });
  } catch (e) { /* wordmark fallback */ }
  mount(el('div', { class: 'min-h-screen flex items-center justify-center', style: { background: 'var(--bg)' } },
    el('div', { class: 'flex flex-col items-center', style: { gap: '14px' } },
      logoImg || el('div', { style: { fontFamily: "var(--font-display,'Anton',system-ui,sans-serif)", fontSize: '2.6rem', letterSpacing: '.02em', color: 'var(--accent)', lineHeight: '1' } }, 'RIDD'),
      el('div', { style: { fontSize: '9px', letterSpacing: '.28em', color: 'var(--text-subtle)', textTransform: 'uppercase' } }, 'Service Above All'),
      el('span', { class: 'spinner', style: { width: '20px', height: '20px', marginTop: '4px' } }),
      el('div', { id: 'splash-watchdog' }))));
  _armSplashWatchdog();
}
// Splash watchdog — if the spinner is still on screen after 12s, offer a
// way out (Retry / Sign out) instead of an infinite brand screen. Sign-out
// matters: a corrupt session is a common cause and reload alone loops.
let _splashWatchTimer = null;
function _armSplashWatchdog() {
  clearTimeout(_splashWatchTimer);
  _splashWatchTimer = setTimeout(() => {
    let host = document.getElementById('splash-watchdog');
    if (!host || !host.isConnected) {
      const mark = document.getElementById('splashMark');
      if (!mark) return;   // splash already gone — booted fine
      host = el('div', { id: 'splash-watchdog', class: 'flex flex-col items-center' });
      (mark.parentElement || mark).append(host);
    }
    host.append(
      el('div', { class: 'flex flex-col items-center', style: { gap: '10px', marginTop: '18px' } },
        el('div', { style: { fontSize: '12px', color: 'var(--text-muted)' } }, 'Taking longer than usual\u2026'),
        el('div', { class: 'flex items-center', style: { gap: '10px' } },
          el('button', {
            class: 'rounded-xl px-2.5 py-1 text-[11px] font-bold',
            style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: () => location.reload(),
          }, 'Retry'),
          el('button', {
            class: 'rounded-xl border px-2.5 py-1 text-[11px] font-semibold',
            style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
            onclick: async () => { try { await supabase.auth.signOut(); } catch (e) { /* best effort */ } location.reload(); },
          }, 'Sign out'))));
  }, 12000);
}

// ── NEW-VERSION BANNER ───────────────────────────────────────────────────
// Installed PWAs never reload on their own — reps resume the same page for
// DAYS, running whatever bundle was live when they last opened it. Poll
// version.json (on boot, every 2 min, and whenever the app comes back to
// the foreground); when a newer deploy is live, pin a banner across the
// top — "New version is available, refresh here" — with a Refresh button.
// Nothing reloads by itself (per Isaac): the user picks the moment.
(() => {
  const _myBundle = (() => {
    try {
      const tag = document.querySelector('script[src*=".immutable.js"]');
      return tag ? String(tag.getAttribute('src')).split('/').pop() : null;
    } catch { return null; }
  })();
  if (!_myBundle) return;   // sandbox / plain app.js — no version to watch
  let _shownFor = '';
  const showBanner = (hash) => {
    if (_shownFor === hash || document.getElementById('newVersionBanner')) return;
    _shownFor = hash;
    const bar = el('div', {
      id: 'newVersionBanner',
      role: 'status',
      style: { position: 'fixed', top: '0', left: '0', right: '0', zIndex: '10000',
               background: 'var(--accent)', color: 'var(--accent-text, #fff)',
               display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '12px', flexWrap: 'wrap',
               padding: 'calc(8px + env(safe-area-inset-top, 0px)) 16px 8px', font: '600 13px/1.3 Archivo, Arial, sans-serif',
               boxShadow: '0 6px 20px -8px rgba(0,0,0,.35)' },
    },
      el('span', {}, 'New version is available, refresh here'),
      el('button', {
        style: { background: '#fff', color: 'var(--accent)', border: 0, borderRadius: '999px', padding: '5px 14px', font: '700 12px/1.2 Archivo, Arial, sans-serif', letterSpacing: '.04em', textTransform: 'uppercase', cursor: 'pointer' },
        onclick: () => { try { sessionStorage.setItem('ridd_reloaded_for', hash); } catch { /* private */ } location.reload(); },
      }, 'Refresh'),
    );
    document.body.append(bar);
    // Push the fixed page header down so the banner never covers the title.
    // (CSS in index.html reads --nv-banner: body.has-nv-banner shifts the
    // fixed header, the Indicators bar and main down by that much, and it
    // survives every re-render because it's a class, not inline styles.)
    const fix = () => { document.documentElement.style.setProperty('--nv-banner', bar.getBoundingClientRect().height + 'px'); };
    document.body.classList.add('has-nv-banner');
    fix(); window.addEventListener('resize', fix);
  };
  const check = async () => {
    try {
      const r = await fetch('/version.json', { cache: 'no-store' });
      if (!r.ok) return;
      const v = await r.json();
      if (!v || !v.hash || v.hash === _myBundle) return;
      // The TV board is an unattended screen (per Isaac, Sep 18): nobody is
      // there to press Refresh, and the board's overlay hides the banner
      // anyway. Reload straight away and come back up on the board.
      if (state._tvOpen) { try { sessionStorage.setItem('ridd_reopen_tv', '1'); sessionStorage.setItem('ridd_reloaded_for', v.hash); } catch { /* private */ } location.reload(); return; }
      showBanner(v.hash);
    } catch { /* offline — next cycle */ }
  };
  setTimeout(check, 4000);
  setInterval(check, 2 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(check, 800); });
})();

// ── RESUME RESYNC ────────────────────────────────────────────────────────
// Everything except sales realtime loads ONCE at boot. Desktop users reload
// all day so they never notice; a phone resumes the same page for days and
// keeps showing the calendar / scorecards / settings / sales as they were
// when it was last opened (Isaac: "mobile isn't syncing"). Re-pull the
// cloud stores whenever the app comes back to the foreground (at most once
// a minute) and every 5 minutes while it stays visible, then remount when
// the user isn't mid-modal or typing.
let _resyncAt = 0, _resyncBusy = false;
async function resyncFromCloud(reason) {
  if ((typeof DEMO !== 'undefined' && DEMO) || typeof supabase === 'undefined' || !supabase || !state.profile) return;
  if (_resyncBusy || Date.now() - _resyncAt < 60 * 1000) return;
  _resyncBusy = true; _resyncAt = Date.now();
  const jobs = [];
  const safe = (fn) => { try { const p = fn(); if (p && p.catch) jobs.push(p.catch(() => {})); } catch (e) { /* skip */ } };
  safe(() => refreshSalesData());
  safe(() => refreshProfilesData());
  safe(() => refreshCompetitionsData());
  safe(() => loadIndicatorConfigFromSupabase());
  safe(() => loadAppSettings());
  safe(() => loadCommissionConfig());
  safe(() => loadCompanyGoal());
  // Calendar: only when nothing local is waiting to push (a pending
  // debounced edit would otherwise be clobbered by the server copy).
  if (typeof _calFp === 'function' && _calFp() === _calCloudFp) safe(() => loadCalendarFromCloud());
  // Reporting snapshot (provenance audit): the snapshot was loaded once per
  // session and never refreshed, so Overview / Daily Pulse / Retention could
  // sit on the morning's data all day. If a newer upload exists and the user
  // is on "latest" (not pinned to an older snapshot), advance and prefetch.
  safe(() => supabase.from('reporting_uploads').select('id, filename, row_count, uploaded_at').order('uploaded_at', { ascending: false }).limit(1).then(({ data }) => {
    const newest = data && data[0]; if (!newest) return;
    const onLatest = !state.reportingActiveUploadId || state.reportingActiveUploadId === state._reportingLatestId;
    if (newest.id !== state._reportingLatestId) {
      state.reportingUploads = [newest, ...(state.reportingUploads || []).filter(u => u.id !== newest.id)];
      state._reportingLatestId = newest.id;
      if (onLatest) {
        state.reportingActiveUploadId = newest.id;
        state._reportingPrefetching = false;
        if (typeof prefetchReportingSnapshot === 'function') prefetchReportingSnapshot();
      }
    }
  }));
  // Scorecards: drop the per-period cache so the next render refetches.
  state._scorecardCloudFor = null;
  if (typeof loadScorecardMeetingsCloud === 'function') safe(() => loadScorecardMeetingsCloud(true));
  try { await Promise.all(jobs); } catch (e) { /* individual jobs already swallowed */ }
  _resyncBusy = false;
  const busyTyping = document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
  if (busyTyping || document.querySelector('.modal-overlay')) return;
  scheduleBackgroundRemount();
}
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') setTimeout(() => resyncFromCloud('resume'), 300); });
window.addEventListener('online', () => setTimeout(() => resyncFromCloud('online'), 300));
setInterval(() => { if (document.visibilityState === 'visible') resyncFromCloud('interval'); }, 5 * 60 * 1000);

// ── CLIENT ERROR TELEMETRY ───────────────────────────────────────────────
// Uncaught errors + promise rejections post to /api/client-error (→ admin
// Slack when SLACK_ADMIN_WEBHOOK is set, Netlify logs always). Deduped per
// message, max 5 per session — a crash loop can't spam anything.
const _errSent = new Set();
function _reportClientError(message, stack) {
  try { if (typeof track === 'function') track('error', String(message || '').slice(0, 160), state.view || null, null, { stack: String(stack || '').slice(0, 400) }); } catch (e) { /* noop */ }
  try {
    if (typeof DEMO !== 'undefined' && DEMO) return;
    const key = String(message || '').slice(0, 120);
    if (!key || _errSent.has(key) || _errSent.size >= 5) return;
    _errSent.add(key);
    const tag = document.querySelector('script[src*=".immutable.js"]');
    fetch('/api/client-error', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        message: key,
        stack: String(stack || '').slice(0, 800),
        view: (typeof state !== 'undefined' && state.view) || '',
        role: (typeof state !== 'undefined' && state.profile && state.profile?.role) || '',
        bundle: tag ? String(tag.getAttribute('src')).split('/').pop() : 'dev',
        ua: navigator.userAgent,
      }),
    }).catch(() => { /* fire and forget */ });
  } catch { /* never let telemetry throw */ }
}
// ── Opt-in render profiler (AUDIT P1-1) ──────────────────────────────────
// localStorage.ridd_prof = '1' turns it on; each mountApp then records the
// view, total ms and per-phase ms into window.__riddProf (last 40 renders)
// so the slow phases can be read off a real login instead of guessed.
const _profOn = (() => { try { return localStorage.getItem('ridd_prof') === '1'; } catch (e) { return false; } })();
let _profCur = null;
function _profStart(view) { if (!_profOn) return; _profCur = { view, t0: performance.now(), last: performance.now(), phases: [] }; }
function _profMark(label) { if (!_profOn || !_profCur) return; const now = performance.now(); _profCur.phases.push([label, Math.round(now - _profCur.last)]); _profCur.last = now; }
function _profEnd() {
  if (!_profOn || !_profCur) return;
  _profMark('render-tail');
  const rec = { view: _profCur.view, ms: Math.round(performance.now() - _profCur.t0), phases: _profCur.phases, at: new Date().toISOString() };
  (window.__riddProf = window.__riddProf || []).push(rec); if (window.__riddProf.length > 40) window.__riddProf.shift();
  console.log('[ridd][prof] ' + rec.view + ' ' + rec.ms + 'ms ' + rec.phases.map(p => p[0] + ':' + p[1]).join(' '));
  _profCur = null;
}
// ── Usage analytics (Sep 2026) ────────────────────────────────────────────
// What people actually do: page views (time on page + render ms), key
// actions, errors, modal open/complete/dismiss pairs and searches. Batched
// and sent with keepalive fetch straight to public.app_events (own rows
// only); Admin → Usage reads the usage_summary() RPC. Never throws, never
// blocks a render, drops everything in DEMO or when signed out.
const _trk = { q: [], sid: null, timer: null, view: null, viewAt: 0, viewSub: null, off: false };
function _trkSession() {
  if (!_trk.sid) { try { _trk.sid = sessionStorage.getItem('ridd_sid'); } catch (e) { /* noop */ } }
  if (!_trk.sid) { _trk.sid = Math.random().toString(36).slice(2, 10) + Date.now().toString(36); try { sessionStorage.setItem('ridd_sid', _trk.sid); } catch (e) { /* noop */ } }
  return _trk.sid;
}
function _trkDevice() { try { return window.matchMedia('(max-width: 640px)').matches ? 'phone' : 'desktop'; } catch (e) { return 'desktop'; } }
function track(event, name, sub, durMs, props) {
  try {
    if (_trk.off || (typeof DEMO !== 'undefined' && DEMO) || !state.profile || !state.session) return;
    _trk.q.push({ user_id: state.profile.id, role: String(state.profile.role || ''), session_id: _trkSession(), device: _trkDevice(),
      event, name: name == null ? null : String(name).slice(0, 160), sub: sub == null ? null : String(sub).slice(0, 80),
      dur_ms: durMs == null ? null : Math.max(0, Math.round(durMs)), props: props || null, at: new Date().toISOString() });
    if (_trk.q.length >= 25) _trkFlush(); else if (!_trk.timer) _trk.timer = setTimeout(_trkFlush, 8000);
  } catch (e) { /* analytics never break the app */ }
}
// Convenience: an action, stamped with how long since the current view opened
// (time-to-complete for the workflow that lives on that view).
function trackAction(name, sub, props) {
  const since = _trk.viewAt ? Math.round(performance.now() - _trk.viewAt) : null;
  track('action', name, sub, null, Object.assign({}, props || {}, since != null ? { since_view_ms: since, view: _trk.view } : {}));
}
// Modal pairs: open → done | dismiss (abandonment = opened − done).
function trackModal(name, phase, openedAt) { track('modal', name, phase, openedAt ? performance.now() - openedAt : null); }
function _trkFlush() {
  if (_trk.timer) { clearTimeout(_trk.timer); _trk.timer = null; }
  const batch = _trk.q.splice(0, 100); if (!batch.length) return;
  try {
    const tok = state.session && state.session.access_token; if (!tok || !CFG || !CFG.SUPABASE_URL) return;
    fetch(CFG.SUPABASE_URL + '/rest/v1/app_events', { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json', apikey: CFG.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + tok, Prefer: 'return=minimal' },
      body: JSON.stringify(batch) }).then(r => { if (r.status === 404 || r.status === 401) _trk.off = true; }).catch(() => {});   // table missing → stop trying this session
  } catch (e) { /* noop */ }
}
// View change: close the previous view (time on page) and open the new one.
function _trkView(view, sub, renderMs) {
  const now = performance.now();
  if (_trk.view && (_trk.view !== view || _trk.viewSub !== sub)) track('view', _trk.view, _trk.viewSub, now - _trk.viewAt, { render_ms: _trk.renderMs || 0, closed: true });
  if (_trk.view !== view || _trk.viewSub !== sub) { _trk.view = view; _trk.viewSub = sub; _trk.viewAt = now; _trk.renderMs = renderMs; track('view', view, sub, null, { render_ms: renderMs, opened: true }); }
}
try {
  window.addEventListener('pagehide', () => { try { if (_trk.view) track('view', _trk.view, _trk.viewSub, performance.now() - _trk.viewAt, { render_ms: _trk.renderMs || 0, closed: true }); _trkFlush(); } catch (e) { /* noop */ } });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') _trkFlush(); });
} catch (e) { /* noop */ }

// ── Source health (P1-7 in AUDIT.md) ─────────────────────────────────────
// Every loader reports ok / error per SOURCE instead of console.warn being
// the terminal state. The header's "Last sync" pill reads the worst of them
// and the status sheet lists each one with when it last worked.
const HEALTH_SOURCES = {
  ops: 'Operations stats (FieldRoutes)',
  indicators: 'Sales dataset (FieldRoutes via RevHawk)',
  reporting:  'Reporting snapshot',
  techstats:  'Technician route stats',
  qbo:        'QuickBooks spend (Windsor)',
  pay:        'Pay settings',
  commission: 'Commission config',
  calendar:   'Calendar cloud save',
  rosters:    'Competition rosters',
  settings:   'Reporting configuration',
};
function healthReport(source, ok, msg) {
  const h = state._health || (state._health = {});
  const cur = h[source] || {};
  h[source] = ok
    ? { ok: true, at: Date.now(), okAt: Date.now(), msg: '' }
    : { ok: false, at: Date.now(), okAt: cur.okAt || null, msg: String(msg && msg.message || msg || 'failed').slice(0, 200) };
  if (!ok) console.warn('[ridd][health] ' + source + ': ' + h[source].msg);
}
// Worst recent problem across sources (errors older than 3h age out).
function healthWorst() {
  const h = state._health || {};
  const bad = Object.entries(h).filter(([, v]) => v && !v.ok && (Date.now() - v.at) < 3 * 3600000);
  return bad.length ? bad.map(([k, v]) => ({ source: k, label: HEALTH_SOURCES[k] || k, ...v })) : [];
}
function openHealthSheet() {
  if (typeof trackAction === 'function') trackAction('health_sheet', 'open');
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const fmtT = (t) => t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '\u2014';
  const rows = Object.keys(HEALTH_SOURCES).map(k => {
    const v = (state._health || {})[k];
    const st = !v ? 'not loaded yet' : v.ok ? 'ok' : 'error';
    const color = st === 'ok' ? '#5F6C5B' : st === 'error' ? '#DC2626' : 'var(--text-subtle)';
    return el('div', { class: 'flex items-start justify-between gap-3 px-3 py-2 text-xs', style: { borderTop: '1px solid var(--border)' } },
      el('div', { class: 'min-w-0' }, el('div', { class: 'font-semibold' }, HEALTH_SOURCES[k]),
        el('div', { class: 'text-[10px] text-muted-' }, st === 'error' ? ('Failed ' + fmtT(v.at) + (v.okAt ? ' \u00b7 last worked ' + fmtT(v.okAt) : '') + ' \u00b7 ' + v.msg) : st === 'ok' ? 'Last loaded ' + fmtT(v.at) : 'Loads when its tab opens')),
      el('span', { class: 'text-[10px] font-bold uppercase tracking-wider shrink-0', style: { color } }, st));
  });
  // Server side (admins): the sync worker's own heartbeat + newest reporting
  // snapshot from /api/sync-status — "the job ran at 3:00 and finished ok
  // in 41 s" instead of only what this browser managed to load.
  const serverRow = isAdminRole(state.profile?.role) ? el('div', { class: 'px-3 py-2 text-xs', style: { borderTop: '1px solid var(--border)' } },
    el('div', { class: 'font-semibold' }, 'Sync worker (server)'),
    el('div', { class: 'text-[10px] text-muted-' }, 'Checking\u2026')) : null;
  if (serverRow) {
    fetch('/api/sync-status', { cache: 'no-store' }).then(r => r.json()).then(j => {
      const lr = j.lastRun || {}, snap = (j.recentSnapshots || [])[0];
      const ok = lr.ok === true || lr.stage === 'finished';
      const bits = [];
      if (lr.at) bits.push((lr.stage === 'failed' ? 'Failed ' : lr.stage === 'finished' ? 'Finished ' : (lr.stage ? 'Running \u00b7 ' + lr.stage + ' \u00b7 ' : '')) + fmtT(lr.at) + (lr.ms ? ' in ' + Math.round(lr.ms / 1000) + ' s' : ''));
      if (lr.error) bits.push(lr.error);
      if (snap && snap.uploaded_at) bits.push('Newest snapshot ' + fmtT(snap.uploaded_at) + (snap.rows ? ' \u00b7 ' + Number(snap.rows).toLocaleString() + ' rows' : ''));
      if (j.minutesSinceLastSnapshot != null) bits.push(j.minutesSinceLastSnapshot + ' min ago');
      if (lr.dataAsOf) bits.unshift('CRM data as of ' + fmtT(lr.dataAsOf));
      serverRow.replaceChildren(
        el('div', { class: 'flex items-start justify-between gap-3' },
          el('div', { class: 'min-w-0' }, el('div', { class: 'font-semibold' }, 'Sync worker (server)'), el('div', { class: 'text-[10px] text-muted-', style: { overflowWrap: 'anywhere' } }, bits.join(' \u00b7 ') || 'No heartbeat yet')),
          el('span', { class: 'text-[10px] font-bold uppercase tracking-wider shrink-0', style: { color: lr.stage === 'failed' ? '#DC2626' : ok ? '#5F6C5B' : 'var(--text-subtle)' } }, lr.stage === 'failed' ? 'error' : ok ? 'ok' : (lr.stage || 'unknown'))));
    }).catch(() => { serverRow.lastChild.textContent = 'Could not reach /api/sync-status'; });
  }
  overlay.append(el('div', { class: 'card p-0 flex flex-col', style: { width: 'min(520px, 94vw)', maxHeight: '80vh', overflow: 'auto' } },
    el('div', { class: 'px-4 py-3 flex items-center justify-between gap-3' },
      el('div', {}, el('div', { class: 'text-sm font-bold', title: SYNC_CADENCE_TEXT }, 'Data sources'), el('div', { class: 'text-[10px] text-muted-' }, (typeof appSyncStampStr === 'function' ? 'Last sync ' + appSyncStampStr() : ''))),
      el('div', { class: 'flex items-center gap-2' },
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => { overlay.remove(); try { refreshIndicatorsFromCloud(true); toast('Refreshing\u2026', 'success'); } catch (e) { /* poll retries */ } } }, '\u21bb Refresh'),
        el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '\u00d7'))),
    serverRow,
    ...rows));
  document.body.append(overlay);
}
window.addEventListener('error', (e) => _reportClientError(e.message, e.error && e.error.stack));
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason || {};
  _reportClientError(r.message || String(e.reason), r.stack);
});

// ── DESKTOP ZOOM/PAN LOCK — the app is an app, not a document ───────────
// Mobile pinch-zoom is already off (viewport meta + touch-action). Desktop
// still zoomed via trackpad pinch (delivered as ctrl+wheel), Safari gesture
// events, and Cmd/Ctrl +/−/0. All blocked here — EXCEPT inside a Leaflet
// map, where pinch/scroll zoom is the whole point.
(() => {
  const inMap = (t) => !!(t && t.closest && t.closest('.leaflet-container'));
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey && !inMap(e.target)) e.preventDefault();   // trackpad pinch / ctrl+scroll zoom
  }, { passive: false });
  ['gesturestart', 'gesturechange', 'gestureend'].forEach(t =>
    window.addEventListener(t, (e) => { if (!inMap(e.target)) e.preventDefault(); }, { passive: false }));
  window.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (['+', '-', '=', '_', '0'].includes(e.key)) e.preventDefault();  // keyboard browser zoom
  });
})();

function mountError(err) {
  _reportClientError('mountError: ' + (err && err.message || err), err && err.stack);
  const msg = String((err && err.message) || err || 'Unknown error');
  const offline = (typeof navigator !== 'undefined' && navigator.onLine === false);
  const isAuth = /jwt|session|token|not signed in|401/i.test(msg);
  const isNet  = offline || /failed to fetch|networkerror|network request|timed? ?out|load failed/i.test(msg);
  const headline = isNet ? 'Can\u2019t reach the server' : isAuth ? 'Session needs a refresh' : 'Something went wrong';
  const friendly = isNet
    ? (offline ? 'You\u2019re offline \u2014 reconnect and tap Try again.' : 'The connection dropped or the server didn\u2019t answer. Your data is safe \u2014 try again in a moment.')
    : isAuth ? 'Your sign-in expired or got out of sync. Sign in again and you\u2019ll land right back in the app.'
    : 'An unexpected error stopped the app from loading.';
  mount(el('div', { class: 'min-h-screen flex items-center justify-center p-6' },
    el('div', { class: 'card p-6 max-w-lg' },
      el('h1', { class: 'text-lg font-semibold mb-2', style: { color: (isNet || isAuth) ? 'var(--text)' : '#f87171' } }, headline),
      el('div', { class: 'text-sm mb-3', style: { color: 'var(--text-muted)' } }, friendly),
      el('details', { class: 'mb-1' },
        el('summary', { class: 'text-[11px] cursor-pointer', style: { color: 'var(--text-subtle)' } }, 'Technical details'),
        el('pre', { class: 'text-xs whitespace-pre-wrap mt-1', style: { color: 'var(--text-subtle)' } }, msg)),
      el('div', { class: 'flex items-center gap-2 mt-3' },
        el('button', {
          class: 'px-2.5 py-1 rounded-lg font-semibold text-[11px]', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => location.reload(),
        }, isNet ? 'Try again' : 'Reload'),
        isAuth && el('button', {
          class: 'px-2.5 py-1 rounded-lg border font-semibold text-[11px]',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: async () => { try { await supabase.auth.signOut(); } catch (e) { /* best effort */ } location.reload(); },
        }, 'Sign in again')))));
}

// ──────────────────────────────────────────────────────────────────────────
// AUTH (login / forgot password / set new password)
// ──────────────────────────────────────────────────────────────────────────
// Password policy for user-chosen passwords (the "Set a new password"
// screen): at least 8 characters, one capital letter, one special character.
const PASSWORD_POLICY = [
  { label: 'At least 8 characters',           test: (p) => (p || '').length >= 8 },
  { label: 'At least one capital letter',     test: (p) => /[A-Z]/.test(p || '') },
  { label: 'At least one special character',  test: (p) => /[^A-Za-z0-9]/.test(p || '') },
];
const passwordPolicyErrors = (p) => PASSWORD_POLICY.filter(r => !r.test(p)).map(r => r.label);
// Sign-up is intentionally absent: accounts are created when an admin invites
// a rep (Admin → Users → Add). The invite email contains a magic link that
// creates the auth row on first click; the rep can later set a password via
// "Forgot password?" → email reset link.
// The SDK persists the session under sb-<project-ref>-auth-token. Reading /
// writing it directly is the lock-free fallback for the password-reset
// flow (the SDK's cross-tab lock has stalled getSession/setSession there).
function authStorageKey() {
  try { return 'sb-' + new URL(CFG.SUPABASE_URL).hostname.split('.')[0] + '-auth-token'; } catch { return null; }
}
function authStoredSession() {
  try {
    const k = authStorageKey(); if (!k) return null;
    const raw = localStorage.getItem(k); if (!raw) return null;
    const j = JSON.parse(raw);
    const sess = j && j.access_token ? j : (j && j.currentSession) || null;   // v2 stores the session itself; older builds wrapped it
    if (!sess || !sess.access_token) return null;
    if (sess.expires_at && sess.expires_at * 1000 < Date.now() - 60000) return null;
    return sess;
  } catch { return null; }
}
function authStoreSession(sess) {
  try {
    const k = authStorageKey(); if (!k || !sess || !sess.access_token) return false;
    const copy = { ...sess };
    if (!copy.expires_at && copy.expires_in) copy.expires_at = Math.floor(Date.now() / 1000) + Number(copy.expires_in);
    localStorage.setItem(k, JSON.stringify(copy));
    return true;
  } catch { return false; }
}
function mountAuth(opts = {}) {
  const initialMode = opts.mode || 'login'; // 'login' | 'forgot' | 'recover'
  // THE DOOR (Cam's design kit, Q-0275): every RIDDMADE login is the same
  // white room — wordmark top left, the app's name in mono top right, a
  // mono LOGIN eyebrow, mono labels over hairline inputs, one black plate.
  // Measured on white: black 21:1, black/70 8.59:1, white on the plate 21:1.
  const DOOR = {
    label: 'block text-[11px] uppercase',
    labelStyle: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.22em', color: 'rgba(0,0,0,.7)' },
    field: 'door-field w-full mt-2 pb-2 text-base',
    fieldStyle: { border: 0, borderBottom: '1px solid rgba(0,0,0,.3)', background: 'transparent', color: '#000', outline: 'none', borderRadius: 0, fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif' },
  };
  const form = el('form', {
    id: 'login-form', method: 'post', action: '#',   // a real, named form — what keychains attach a saved login to
    class: 'w-full flex flex-col gap-6',
    style: { maxWidth: '320px', color: '#000' },
    novalidate: true,   // our own checks below give real messages; native validation on a hidden field blocks submit with no feedback
    onsubmit: async (e) => {
      e.preventDefault();
      const email    = form.email?.value?.trim();
      const password = form.password?.value;
      const mode     = form.dataset.mode;

      let done = false;   // recover: success card is showing — don't reset the form in `finally`
      // Native validation is off (novalidate) — do the obvious checks here so
      // the rep always gets a message instead of a dead button.
      const _need = (cond, msg, field) => { if (!cond) { errLine.textContent = msg; errLine.style.display = 'block'; try { field && field.querySelector('input').focus(); } catch {} return false; } return true; };
      if (mode !== 'recover' && !_need(email && /\S+@\S+\.\S+/.test(email), 'Enter your email address.', emailField)) return;
      if (mode !== 'forgot' && !_need(password, mode === 'recover' ? 'Type a new password.' : 'Enter your password.', passField)) return;
      if (mode === 'recover' && !_need(form.confirm?.value, 'Type the new password again to confirm it.', confirmField)) return;
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span>';
      errLine.style.display = 'none';
      try {
        if (mode === 'login') {
          // Sign in straight against the auth REST API — the SDK's
          // signInWithPassword sits behind a cross-tab auth lock that can
          // stall forever when the app is open in another tab (the "hit
          // Sign in and nothing happens" report, per Isaac). Same approach
          // the reset flow uses; hard timeouts so the button always answers.
          const withTimeout = (pr, ms, msg) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
          const tryPw = (pw) => withTimeout(fetch(CFG.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
            method: 'POST',
            headers: { apikey: CFG.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password: pw }),
          }), 12000, 'Sign-in is taking too long — check your connection and try again.');
          let t = await tryPw(password);
          // Phone keyboards love sneaking a trailing space into typed or
          // pasted passwords — if the exact string failed and trimming
          // would change it, quietly retry once with the trimmed password.
          if (!t.ok && password && password.trim() !== password) t = await tryPw(password.trim());
          if (!t.ok) {
            let m = '';
            try { const j = await t.json(); m = j.error_description || j.msg || j.message || j.error || ''; } catch { /* no body */ }
            console.warn('[login] sign-in failed', t.status, m);
            if (/invalid login credentials|invalid_grant|invalid_credentials/i.test(m) || t.status === 400) m = 'Wrong email or password. If you just reset it, use the new password — or tap Forgot password? to set another.';
            else if (/email not confirmed/i.test(m)) m = 'This email hasn’t been confirmed yet — open the invite link in your email first.';
            else if (/rate limit|too many/i.test(m)) m = 'Too many attempts — wait a minute and try again.';
            throw new Error(m || 'Could not sign in (' + t.status + '). Try again.');
          }
          const fresh = await t.json();
          if (!fresh || !fresh.access_token) throw new Error('Sign-in did not return a session — try again.');
          // Hand the session to the SDK (bounded — the lock again), else
          // store it exactly where the SDK reads it on boot.
          try { await withTimeout(supabase.auth.setSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token }), 4000, 'lock'); }
          catch (e) { console.warn('[login] setSession stalled — storing the session directly', e && e.message); authStoreSession(fresh); }
          try { localStorage.setItem('ridd_last_auth_v1', String(Date.now())); } catch { /* private */ }
          console.log('[login] signed in');
          done = true;
          submitBtn.innerHTML = '\u2713 Signed in';
          // Boot from a clean load so the app comes up on the new session
          // every time (no dependence on the SDK's auth-change event firing).
          setTimeout(() => location.replace(window.location.pathname + (window.location.hash || '')), 250);
          return;
        } else if (mode === 'forgot') {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: authEmailRedirectUrl(),
          });
          if (error) {
            // Map Supabase's terse errors to something a rep can act on.
            if (/rate limit|security purposes/i.test(error.message || '')) throw new Error('Too many reset requests — wait a minute and try once more.');
            throw error;
          }
          toast('Reset link sent — check your email. Open it on THIS device and browser.', 'success');
          form.dataset.mode = 'login';
          renderMode();
        } else if (mode === 'recover') {
          // Enforce the password policy before touching the network.
          const missing = passwordPolicyErrors(password);
          if (missing.length) {
            throw new Error('Password needs: ' + missing.join(' · ').toLowerCase() + '.');
          }
          if ((form.confirm?.value || '') !== password) {
            confirmField.querySelector('input').focus();
            throw new Error('The two passwords don’t match — type the same password in both boxes.');
          }
          // Every step is visible on the button and logged as [recover] so a
          // stuck save is never "nothing happens" (per Isaac).
          const step = (t) => { submitBtn.innerHTML = '<span class="spinner"></span> ' + t; console.log('[recover]', t); };
          const withTimeout = (pr, ms, msg) => Promise.race([pr, new Promise((_, rej) => setTimeout(() => rej(new Error(msg)), ms))]);
          // 1. The reset link must have established a recovery session. The
          //    SDK's cross-tab auth lock can stall getSession() when the app
          //    is open in another tab, so give it 4s then read the session
          //    the SDK persisted in storage instead.
          step('Checking your reset link…');
          let rec = null;
          try { rec = (await withTimeout(supabase.auth.getSession(), 4000, 'lock')).data.session; }
          catch (e) { console.warn('[recover] getSession stalled — reading the stored session instead', e && e.message); }
          if (!rec || !rec.access_token) rec = authStoredSession();
          if (!rec || !rec.access_token) {
            throw new Error('This reset link has expired or was already used. Request a new one, or ask an admin to set your password directly.');
          }
          // 2. Save the password straight to the auth REST API (same call the
          //    SDK's updateUser makes) — no SDK lock in the way, hard timeout.
          step('Saving password…');
          const r = await withTimeout(fetch(CFG.SUPABASE_URL + '/auth/v1/user', {
            method: 'PUT',
            headers: { apikey: CFG.SUPABASE_PUBLISHABLE_KEY, Authorization: 'Bearer ' + rec.access_token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ password }),
          }), 15000, 'Saving is taking too long — check your connection and try again.');
          if (!r.ok) {
            let m = '';
            try { const j = await r.json(); m = j.msg || j.message || j.error_description || j.error || ''; } catch { /* no body */ }
            console.warn('[recover] password save failed', r.status, m);
            if (r.status === 401 || r.status === 403) m = 'This reset link has expired or was already used. Request a new one.';
            else if (/same password|different from the old/i.test(m)) m = 'That is already your password — pick a new one, or just sign in with it.';
            else if (/weak|easy to guess|pwned|leaked|compromised/i.test(m)) m = 'That password is too common — pick something less guessable.';
            throw new Error(m || 'Could not save the password (' + r.status + '). Try again.');
          }
          console.log('[recover] password saved');
          // 3. Sign in with the new password so the app runs on a normal
          //    session, not the one-time recovery session.
          step('Signing you in…');
          const recEmail = (rec.user && rec.user.email) || email || '';
          let fresh = null;
          if (recEmail) {
            try {
              const t = await withTimeout(fetch(CFG.SUPABASE_URL + '/auth/v1/token?grant_type=password', {
                method: 'POST',
                headers: { apikey: CFG.SUPABASE_PUBLISHABLE_KEY, 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: recEmail, password }),
              }), 10000, 'sign-in timeout');
              if (t.ok) fresh = await t.json(); else console.warn('[recover] sign-in with the new password returned', t.status);
            } catch (e) { console.warn('[recover] sign-in skipped', e && e.message); }
          }
          if (fresh && fresh.access_token) {
            try { await withTimeout(supabase.auth.setSession({ access_token: fresh.access_token, refresh_token: fresh.refresh_token }), 4000, 'lock'); }
            catch (e) { console.warn('[recover] setSession stalled — storing the session directly', e && e.message); authStoreSession(fresh); }
            console.log('[recover] signed in with the new password');
          }
          // (No fresh session → the recovery session the SDK already persisted
          // still signs them in on reload; the password is saved either way.)
          // 4. Success screen, then the default dashboard.
          try {
            sessionStorage.removeItem('ridd_recovery_pending');
            sessionStorage.setItem('ridd_pw_saved', '1');
            localStorage.setItem('ridd_last_auth_v1', String(Date.now()));
          } catch { /* private mode — reload still works */ }
          done = true;
          heading.textContent = 'Password updated';
          subheading.textContent = 'You’re signed in — taking you to your dashboard…';
          subheading.style.display = '';
          backBtn.style.display = 'none';
          passField.style.display = 'none';
          confirmField.style.display = 'none';
          policyList.style.display = 'none';
          errLine.style.display = 'none';
          submitBtn.innerHTML = '✓ Password updated';
          // CLEAN url before the reload — keeping window.location.search
          // here preserved the PKCE reset link's `?code=` param, so the
          // reload re-ran the already-used code exchange and could bounce
          // the rep to the login screen instead of into the app. NO hash
          // either (per Isaac): an empty hash lets boot route each rep to
          // their role's DEFAULT screen (D2D → Sales group, office staff →
          // Sales tab, admins → Dashboard) instead of forcing Indicators.
          history.replaceState(null, '', window.location.pathname);
          setTimeout(() => location.replace(window.location.pathname), 900);   // let the success card paint
          return;
        }
      } catch (err) {
        // Inline + toast: the toast pops top-right and is easy to miss on a
        // phone (often behind the keyboard) — the red line under the button
        // is impossible to miss.
        errLine.textContent = err.message || 'Something went wrong — try again.';
        errLine.style.display = 'block';
        toast(err.message || 'Auth failed', 'error');
      } finally {
        if (!done) { submitBtn.disabled = false; renderMode(); }
      }
    },
  });
  const errLine = el('div', {
    class: 'font-semibold py-1 pl-3',
    style: { display: 'none', fontSize: '14px', color: '#000', borderLeft: '2px solid #DF643A', lineHeight: '1.5' },
  });

  form.dataset.mode = initialMode;

  const heading    = el('p', { class: 'text-[11px] uppercase', style: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.24em', color: '#000' } });
  const subheading = el('p', { class: 'text-[10px] uppercase', style: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.08em', lineHeight: '1.6', color: 'rgba(0,0,0,.7)', marginTop: '-12px' } });
  // Reset screen only: ← back to sign in. Drops the one-time recovery
  // session too, so a later refresh lands on the login page instead of
  // quietly signing them into the app with no password set.
  const backBtn = el('button', { type: 'button', class: 'inline-flex items-center gap-1 text-[10px] uppercase self-start', style: { display: 'none', fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.18em', color: 'rgba(0,0,0,.7)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' }, title: 'Back to sign in',
    onclick: () => {
      try { sessionStorage.removeItem('ridd_recovery_pending'); } catch { /* private mode */ }
      history.replaceState(null, '', window.location.pathname);
      form.dataset.mode = 'login';
      form.password.value = ''; form.confirm.value = '';
      renderMode();
      Promise.race([supabase.auth.signOut(), new Promise(r => setTimeout(r, 3000))])
        .catch(() => {})
        .finally(() => { try { const k = authStorageKey(); if (k) localStorage.removeItem(k); } catch { /* ignore */ } state.session = null; });
    } },
    el('span', { 'aria-hidden': 'true' }, '←'), 'Back to sign in');
  const emailField = el('label', { class: 'block' },
    el('span', { class: DOOR.label, style: DOOR.labelStyle }, 'Email'),
    // Password-manager friendly (per Isaac, Sep 2026): the phone keychains
    // (iOS Passwords, Google) only offer a saved login when the username field
    // says autocomplete="username" and the form pairs it with a
    // current-password field — the same cue the desktop browsers key off.
    el('input', { id: 'login-email', name: 'email', type: 'email', required: true, autocomplete: 'username', inputmode: 'email', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', class: DOOR.field, style: DOOR.fieldStyle, placeholder: 'you@ridd.com', onfocus: (e) => { e.target.style.borderBottomColor = '#000'; }, onblur: (e) => { e.target.style.borderBottomColor = 'rgba(0,0,0,.3)'; } }));
  // Password input with a show/hide eye inside the box (per Isaac). One
  // eye per field; the confirm field gets its own so each can be peeked.
  const EYE_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>';
  const EYE_OFF  = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-6.5 0-10-7-10-7a19.8 19.8 0 0 1 5.06-5.94"/><path d="M9.9 4.24A10.9 10.9 0 0 1 12 4c6.5 0 10 7 10 7a19.8 19.8 0 0 1-3.22 4.19"/><path d="M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  const passwordBox = (name, label, placeholder) => {
    const input = el('input', { id: 'login-' + name, name, type: 'password', required: true, minlength: 6, autocomplete: name === 'password' ? 'current-password' : 'new-password', autocapitalize: 'off', autocorrect: 'off', spellcheck: 'false', class: DOOR.field, style: { ...DOOR.fieldStyle, paddingRight: '32px' }, placeholder, onfocus: (e) => { e.target.style.borderBottomColor = '#000'; }, onblur: (e) => { e.target.style.borderBottomColor = 'rgba(0,0,0,.3)'; } });
    const eye = el('button', { type: 'button', tabindex: -1, title: 'Show password', 'aria-label': 'Show password',
      class: 'absolute right-0 flex items-center px-1 transition', style: { top: 0, bottom: 0, background: 'transparent', border: 0, cursor: 'pointer', color: 'rgba(0,0,0,.7)' },
      onclick: () => { const show = input.type === 'password'; input.type = show ? 'text' : 'password'; eye.innerHTML = show ? EYE_OFF : EYE_OPEN; eye.title = eye.ariaLabel = show ? 'Hide password' : 'Show password'; input.focus(); } });
    eye.innerHTML = EYE_OPEN;
    return el('label', { class: 'block' },
      el('span', { class: DOOR.label, style: DOOR.labelStyle }, label),
      el('div', { class: 'relative' }, input, eye));
  };
  const passField    = passwordBox('password', 'Password', '••••••••');
  const confirmField = passwordBox('confirm', 'Confirm password', '••••••••');   // recover only — typed twice so a typo can't lock them out
  confirmField.style.display = 'none';
  confirmField.querySelector('input').required = false;
  // Live policy checklist — shown only on the "Set a new password" screen.
  const MATCH_LABEL = 'Both passwords match';
  const policyList = el('div', { class: 'text-[11px] flex flex-col gap-1', style: { display: 'none', lineHeight: '1.4' } },
    ...[...PASSWORD_POLICY, { label: MATCH_LABEL }].map(r => el('div', { 'data-req': r.label, style: { color: 'var(--text-subtle)', transition: 'color .15s' } }, '○ ' + r.label)));
  const refreshPolicy = () => {
    if (form.dataset.mode !== 'recover') return;
    const p = passField.querySelector('input').value, c = confirmField.querySelector('input').value;
    const checks = [...PASSWORD_POLICY.map(r => ({ label: r.label, ok: r.test(p) })), { label: MATCH_LABEL, ok: !!p && p === c }];
    checks.forEach(r => {
      const row = policyList.querySelector('[data-req="' + r.label + '"]');
      if (!row) return;
      row.textContent = (r.ok ? '✓ ' : '○ ') + r.label;
      row.style.color = r.ok ? '#DF643A' : 'var(--text-subtle)';
    });
    // Confirm box: neutral until something is typed in it, then red until it
    // matches the first box, then green (per Isaac).
    const ci = confirmField.querySelector('input');
    if (!c) { ci.style.borderColor = ''; ci.style.boxShadow = ''; ci.style.background = ''; }
    else if (p === c) { ci.style.borderColor = '#5F6C5B'; ci.style.boxShadow = '0 0 0 2px rgba(95,108,91,.18)'; ci.style.background = 'rgba(95,108,91,.05)'; }
    else { ci.style.borderColor = '#DC2626'; ci.style.boxShadow = '0 0 0 2px rgba(220,38,38,.15)'; ci.style.background = 'rgba(220,38,38,.04)'; }
  };
  // Password managers / iOS autofill can drop a value in without an
  // `input` event, which left the confirm box un-coloured until a click.
  // Listen to everything AND poll while the reset screen is up so the box
  // turns green the moment the two values agree, however they got there.
  for (const inp of [passField.querySelector('input'), confirmField.querySelector('input')]) {
    for (const ev of ['input', 'change', 'keyup', 'paste', 'blur', 'animationstart']) inp.addEventListener(ev, refreshPolicy);
  }
  let _policyTimer = null, _policyLast = '';
  const policyWatch = (on) => {
    if (_policyTimer) { clearInterval(_policyTimer); _policyTimer = null; }
    if (!on) return;
    _policyTimer = setInterval(() => {
      if (!form.isConnected) { clearInterval(_policyTimer); _policyTimer = null; return; }
      const sig = passField.querySelector('input').value + '\u0000' + confirmField.querySelector('input').value;
      if (sig !== _policyLast) { _policyLast = sig; refreshPolicy(); }
    }, 200);
  };
  // The plate: black, Archivo, uppercase — the market plate Cam signed.
  const submitBtn  = el('button', { type: 'submit', class: 'w-full uppercase cursor-pointer', style: { background: '#000', color: '#fff', fontFamily: 'Archivo, ui-sans-serif, system-ui, sans-serif', fontWeight: 600, fontSize: '1.375rem', lineHeight: 1, letterSpacing: '.03em', padding: '16px 24px', border: 0, borderRadius: 0, marginTop: '8px' } });
  const forgotBtn  = el('button', { type: 'button', class: 'text-[10px] uppercase self-start', style: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.18em', color: 'rgba(0,0,0,.7)', background: 'transparent', border: 0, padding: 0, cursor: 'pointer' },
    onclick: () => { form.dataset.mode = form.dataset.mode === 'login' ? 'forgot' : 'login'; renderMode(); } });
  // Onboarding hint for invited reps. Accounts are admin-created; the invite
  // email contains a one-time magic link that signs the rep in but does NOT
  // set a password. To get a password (so they can sign in here next time),
  // the rep then has to use Forgot password. Without this hint a confused
  // rep types whatever password into the login form and gets back a bare
  // "Invalid credentials" from Supabase.
  const inviteHint = el('p', {
    class: 'text-[10px] uppercase',
    style: { lineHeight: '1.6', fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.08em', color: 'rgba(0,0,0,.7)' },
  }, 'First time here? An admin must invite you. Click the link in your invite email to get in — then use ',
    el('strong', {}, 'Forgot password?'),
    ' above to set a password for next time.');

  function renderMode() {
    const mode = form.dataset.mode;
    backBtn.style.display = 'none';
    policyWatch(mode === 'recover');
    if (mode === 'login') {
      heading.textContent    = 'Login';
      subheading.textContent = '';           // (dropped the 'RIDD Sales App' line per Isaac)
      subheading.style.display = 'none';
      emailField.style.display = 'block';
      emailField.querySelector('input').required = true;
      passField.style.display  = 'block';
      passField.querySelector('input').required = true;
      passField.querySelector('input').autocomplete = 'current-password';
      confirmField.style.display = 'none';
      confirmField.querySelector('input').required = false;
      submitBtn.textContent = 'Login';
      forgotBtn.textContent = 'Forgot password?';
      forgotBtn.style.display = '';
      inviteHint.style.display = 'block';
    } else if (mode === 'forgot') {
      heading.textContent    = 'Reset password';
      subheading.textContent = 'Enter your email and we’ll send you a reset link.';
      subheading.style.display = '';
      emailField.style.display = 'block';
      emailField.querySelector('input').required = true;
      passField.style.display  = 'none';
      passField.querySelector('input').required = false;
      confirmField.style.display = 'none';
      confirmField.querySelector('input').required = false;
      submitBtn.textContent = 'Send reset link';
      forgotBtn.textContent = 'Back to sign in';
      forgotBtn.style.display = '';
      inviteHint.style.display = 'none';
    } else if (mode === 'recover') {
      backBtn.style.display = 'inline-flex';
      heading.textContent    = 'Set a new password';
      subheading.textContent = 'Pick the password you’ll use from now on.';
      subheading.style.display = '';
      emailField.style.display = 'none';
      emailField.querySelector('input').required = false;   // hidden + required = the browser blocks submit silently (the 'Set password does nothing' bug)
      passField.style.display  = 'block';
      passField.querySelector('input').required = true;
      passField.querySelector('input').minLength = 8;
      passField.querySelector('input').autocomplete = 'new-password';
      confirmField.style.display = 'block';
      confirmField.querySelector('input').required = true;
      confirmField.querySelector('input').minLength = 8;
      submitBtn.textContent = 'Set password';
      refreshPolicy();
      forgotBtn.style.display = 'none';
      inviteHint.style.display = 'none';
      policyList.style.display = 'flex';
      return;
    }
    policyList.style.display = 'none';
  }

  form.append(backBtn, heading, subheading, emailField, passField, confirmField, policyList, submitBtn, errLine, forgotBtn, inviteHint);
  renderMode();

  // The room (design kit door.tsx): white, edge to edge, wordmark top left,
  // the app's name in mono top right, the form centred in a 320px column.
  const room = el('main', { class: 'flex flex-col w-full', style: { minHeight: '100svh', background: '#fff', color: '#000', padding: '20px 20px' } },
    el('header', { class: 'flex items-center justify-between' },
      (typeof riddmadeWordmark === 'function') ? riddmadeWordmark(150) : el('div', { class: 'font-display text-2xl' }, 'RIDDMADE'),
      el('span', { class: 'text-[11px] uppercase', style: { fontFamily: "'IBM Plex Mono', ui-monospace, monospace", letterSpacing: '.2em' } }, 'Sales')),
    el('div', { class: 'flex flex-1 flex-col items-center justify-center', style: { padding: '64px 0' } }, form));
  mount(room);
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN APP SHELL
// ──────────────────────────────────────────────────────────────────────────
const TAB_TITLES = {
  dashboard:    'SALES',
  sales:        'SALES',
  pay:          'PAY STUB',
  calendar:     'CALENDAR',
  competitions: 'COMPETITIONS',
  hall_of_fame: 'HALL OF FAME',
  queues:       'QUEUES',
  indicators:   'INDICATORS',
  nrla:         'COMPETITIONS',
  scorecards:   'SCORECARDS',
  reporting:    'REPORTING',
  marketing:    'MARKETING',
  commission:   'SALES',
  d2d_dashboard: 'SALES',
  d2d_sales:    'SALES',
  techs:        'SALES',
  tech_sales:   'SALES',
  tech_pay:     'PAY STUB',
  admin:        'SETTINGS',
};

// #history is kept as a legacy alias — it lands the user on Sales tab with
// the History queue pill pre-selected (see boot/hashchange handlers below).
const HASH_MAP = { '#dashboard':'dashboard', '#sales':'sales', '#pay':'pay', '#calendar':'calendar', '#history':'sales', '#competitions':'competitions', '#halloffame':'hall_of_fame', '#indicators':'indicators', '#nrla':'nrla', '#scorecards':'scorecards', '#reporting':'reporting', '#marketing':'marketing', '#commission':'commission', '#d2ddash':'d2d_dashboard', '#d2dupfront':'commission', '#d2dsales':'d2d_sales', '#techs':'techs', '#techsales':'tech_sales', '#techpay':'tech_pay', '#admin':'admin' };
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
      el('h3', { class: 'text-sm font-bold' }, 'Notifications'),
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
    ['indicators', 'Trends', iconChart],
  ] : [
    // Sales-Rep accounts: Sales (their commission home) + Competitions +
    // rep-lite Indicators.
    [(typeof D2D_SALES_TAB_KEYS !== 'undefined' && D2D_SALES_TAB_KEYS.has(state._lastD2dTab) ? state._lastD2dTab : 'd2d_dashboard'), 'Sales', iconDollar],
    ['nrla', 'Competitions', iconTrophy],
    ['indicators', 'Indicators', iconChart],
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
          ['hall_of_fame','Hall of Fame',iconCrown],
          ...(isAdmin ? [['indicators','Indicators',iconChart]] : []),
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

