// RIDD Sales Platform — single-file-app controller
// ──────────────────────────────────────────────────────────────────────────
// Module imports via CDN (no bundler, no install)
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4';

const CFG = window.RIDD_CONFIG;
const hasConfig = CFG.SUPABASE_PUBLISHABLE_KEY && !CFG.SUPABASE_PUBLISHABLE_KEY.includes('PASTE_');
const DEMO = new URLSearchParams(location.search).has('demo') || location.hash === '#demo';
const supabase = hasConfig
  ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true } })
  : null;

// Role helpers — keep "has admin powers" and "is a seller" consistent across
// the codebase. `admin_rep` is an admin who also sells (on leaderboard, has a
// Pay tab); `admin` is admin-only (not on leaderboard, no sales).
const ADMIN_ROLES   = ['admin', 'admin_rep'];
const SELLER_ROLES  = ['rep', 'admin_rep'];
const isAdminRole   = (r) => ADMIN_ROLES.includes(r);
const isSellerRole  = (r) => SELLER_ROLES.includes(r);

// ──────────────────────────────────────────────────────────────────────────
// Demo state persistence — keep sales/competitions alive across page reloads
// so you can log a sale → audit → stage → process without losing your work
// every time the code updates. Passing ?demo&reset clears storage.
// ──────────────────────────────────────────────────────────────────────────
const DEMO_STORAGE_KEY = 'ridd-demo-data-v1';

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
    if (Array.isArray(parsed.indicatorsData)) state.indicatorsData = parsed.indicatorsData;
  } catch (err) {
    console.warn('[ridd] failed to load demo state', err);
  }
}

function saveDemoData() {
  if (!DEMO) return;
  try {
    const data = {
      mySales:      state.mySales,
      allSales:     state.allSales,
      competitions: state.competitions,
      compRules:    state.compRules,
      compProgress: state.compProgress,
      allProfiles:  state.allProfiles,
      auditLog:      state.auditLog,
      notifLastSeen: state.notifLastSeen,
      indicatorsData:state.indicatorsData,
      companyGoal:   state.companyGoal,
      appSettings:   state.appSettings,
      savedAt: new Date().toISOString(),
    };
    const payload = JSON.stringify(data);
    localStorage.setItem(DEMO_STORAGE_KEY, payload);
    // Verify it actually saved
    const check = localStorage.getItem(DEMO_STORAGE_KEY);
    if (!check) {
      toast('Save failed — localStorage returned empty after write', 'error');
    }
  } catch (err) {
    console.error('[ridd] SAVE FAILED:', err.name, err.message, err);
    toast('Save failed: ' + (err.message || err.name || 'unknown error'), 'error');
  }
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
  // Keep only last 200 entries
  if (state.auditLog.length > 200) state.auditLog.length = 200;
}

// ──────────────────────────────────────────────────────────────────────────
// Utilities
// ──────────────────────────────────────────────────────────────────────────
const $  = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const el = (tag, attrs = {}, ...children) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
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
  pct:   n => (n == null ? '—' : (Number(n) * 100).toFixed(2) + '%'),
  int:   n => (n == null ? '—' : Number(n).toLocaleString('en-US')),
  date:  s => (s ? new Date(s + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' }) : '—'),
  dateShort: s => (s ? new Date(s + 'T00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : '—'),
};

function toast(msg, type = 'info') {
  const colors = {
    info:    'bg-eerie3 border-battleship text-smoke',
    success: 'bg-lime text-eerie border-lime-600',
    error:   'bg-red-500 text-white border-red-600',
    warn:    'bg-amber-500 text-eerie border-amber-600',
  };
  const t = el('div', {
    class: `pointer-events-auto fade-in rounded-xl border px-4 py-3 shadow-lg min-w-[240px] max-w-[360px] ${colors[type]}`,
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
};
// Debug: expose state for console inspection (remove before prod)
window.__RIDD = state;

function applyTheme(theme) {
  state.theme = theme;
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('ridd-theme', theme);
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#0F0F0F' : '#F3F3F3');
}
applyTheme(state.theme);

function toggleTheme() {
  applyTheme(state.theme === 'light' ? 'dark' : 'light');
  if (state.session || DEMO) mountApp();
}

// ──────────────────────────────────────────────────────────────────────────
// Boot sequence
// ──────────────────────────────────────────────────────────────────────────
async function boot() {
  if (DEMO) {
    loadDemoData();
    const hv = HASH_MAP[location.hash];
    if (hv) state.view = hv;
    mountApp();
    window.addEventListener('hashchange', () => {
      const v = HASH_MAP[location.hash];
      if (v && v !== state.view) { state.view = v; mountApp(); }
    });
    return;
  }
  if (!supabase) {
    mountConfigMissing();
    return;
  }
  const { data: { session } } = await supabase.auth.getSession();
  state.session = session;

  // If the user landed here from a password-reset email, the URL fragment
  // carries `type=recovery` (Supabase auto-creates a temporary session).
  // Show the "set new password" screen instead of dropping them into the app.
  const recoveryNow = location.hash.includes('type=recovery');

  supabase.auth.onAuthStateChange((event, session) => {
    state.session = session;
    if (event === 'PASSWORD_RECOVERY') { mountAuth({ mode: 'recover' }); return; }
    if (session) loadAndRender();
    else mountAuth();
  });

  if (recoveryNow) {
    mountAuth({ mode: 'recover' });
    return;
  }
  if (!session) {
    mountAuth();
    return;
  }
  const hv2 = HASH_MAP[location.hash];
  if (hv2) state.view = hv2;
  await loadAndRender();
  window.addEventListener('hashchange', () => {
    const v = HASH_MAP[location.hash];
    if (v && v !== state.view) { state.view = v; mountApp(); }
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
  state.contractTypes = [
    { id: 1, name: '12 Months',        implied_months: 12 },
    { id: 2, name: '18 Months',        implied_months: 18 },
    { id: 3, name: '24 Months',        implied_months: 24 },
    { id: 4, name: 'Upsell - D2D',     implied_months: null },
    { id: 5, name: 'Upsell - Office',  implied_months: null },
    { id: 6, name: 'One Time Service', implied_months: 0 },
  ];
  // Avatars default to null — initials show until an admin uploads a photo.
  state.profile = {
    id: 'demo-1', full_name: 'Isaac Hunter', email: 'isaac@ridd.com', role: 'admin_rep', office_id: 3, initials: 'IH',
    avatar_url: null,
    upfront_commission_rate: 0.07, below_min_commission_rate: 0.035, close_rate_target: 0.60,
    annual_revenue_goal: 750000,
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
    { ...state.profile, slack_user_id: 'U01AB2CD3EF', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.60 },
    { id: 'demo-2', full_name: 'Pere LeSueur',   email: 'pere@ridd.com',   role: 'rep', office_id: 3, initials: 'PL', avatar_url: null,   annual_revenue_goal: 500000, slack_user_id: 'U02PQ0PK95F', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.60 },
    { id: 'demo-3', full_name: 'Connor Bird',    email: 'connor@ridd.com', role: 'rep', office_id: 8, initials: 'CB', avatar_url: null, annual_revenue_goal: 500000, slack_user_id: 'U09CJEY1VD4', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.60 },
    { id: 'demo-4', full_name: 'Elijah Norman',  email: 'elijah@ridd.com', role: 'rep', office_id: 8, initials: 'EN', avatar_url: null, annual_revenue_goal: 500000, slack_user_id: 'U0ALYGD8W0P', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.60 },
    { id: 'demo-5', full_name: 'Sean Hernandez', email: 'sean@ridd.com',   role: 'rep', office_id: 1, initials: 'SH', avatar_url: null,   annual_revenue_goal: 500000, slack_user_id: 'U078915SF0W', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.60 },
    { id: 'demo-6', full_name: 'Drew Sauer',     email: 'drew@ridd.com',   role: 'rep', office_id: 2, initials: 'DS', avatar_url: null,   annual_revenue_goal: 500000, slack_user_id: 'U09CJEVKFHC', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.60 },
    { id: 'demo-7', full_name: 'Andrew Peterson',email: 'andrew@ridd.com', role: 'rep', office_id: 4, initials: 'AP', avatar_url: null, annual_revenue_goal: 500000, slack_user_id: 'U0711E707KP', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.60 },
    { id: 'demo-8', full_name: 'Jackson Brooks', email: 'jackson@ridd.com',role: 'rep', office_id: 5, initials: 'JB', avatar_url: null,annual_revenue_goal: 500000, slack_user_id: 'U09A381G8A2', is_active: true, upfront_commission_rate: 0.07, close_rate_target: 0.60 },
  ];
  // App-wide settings that only admins see (stored as state — would be app_settings rows in prod)
  state.appSettings = state.appSettings || { slack_bot_token: '' };
  // Legacy shape — computed on the fly now; kept for pre-rewrite callers
  state.leaderboard = [];

  // ── Load persisted demo state LAST so it overwrites the hardcoded defaults above.
  //    This is what keeps avatars, settings, sales, etc. alive across reloads.
  //    Pass ?demo&reset to clear everything and start fresh. ──
  if (new URLSearchParams(location.search).has('reset')) {
    localStorage.removeItem(DEMO_STORAGE_KEY);
  } else {
    loadPersistedDemoState();
  }
}

async function loadAndRender() {
  mountLoading();
  try {
    await loadProfile();
    await loadLookups();
    await loadData();
    mountApp();
  } catch (err) {
    console.error(err);
    mountError(err);
  }
}

// ──────────────────────────────────────────────────────────────────────────
// Data loaders
// ──────────────────────────────────────────────────────────────────────────
async function loadProfile() {
  const uid   = state.session.user.id;
  const user  = state.session.user;
  // maybeSingle() returns null instead of throwing when no row matches —
  // lets us self-heal an orphaned auth.users row by inserting a profile
  // (e.g. when the schema was reset after the auth user was already created).
  const { data, error } = await supabase.from('profiles').select('*').eq('id', uid).maybeSingle();
  if (error) throw error;
  if (data) { state.profile = data; return; }

  const fullName = user.user_metadata?.full_name
    || user.user_metadata?.name
    || (user.email ? user.email.split('@')[0] : 'User');
  const { data: created, error: insertErr } = await supabase
    .from('profiles')
    .insert({ id: uid, email: user.email, full_name: fullName, role: 'rep' })
    .select('*')
    .single();
  if (insertErr) throw insertErr;
  state.profile = created;
}

// Debug aid — expose runtime state so it can be inspected from DevTools
// without needing to re-bundle. Safe to leave in: only the publishable key
// is reachable through this, which is already public.
if (typeof window !== 'undefined') {
  window.__ridd = { get state() { return state; }, isAdminRole, ADMIN_ROLES };
}

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
  state.contractTypes = contractTypes.data || [];
}

async function loadData() {
  const isAdmin = isAdminRole(state.profile.role);
  const salesQuery = supabase.from('sales').select('*').order('sold_date', { ascending: false });

  const [mySales, comps, rules, progress, leaderboard] = await Promise.all([
    isAdmin ? salesQuery : supabase.from('sales').select('*').eq('rep_id', state.profile.id).order('sold_date', { ascending: false }),
    supabase.from('competitions').select('*').order('start_date', { ascending: false }),
    supabase.from('competition_rules').select('*'),
    supabase.from('competition_progress').select('*'),
    supabase.from('leaderboard').select('*'),
  ]);

  state.mySales      = mySales.data || [];
  state.allSales     = isAdmin ? (mySales.data || []) : [];
  state.competitions = comps.data || [];
  state.compRules    = rules.data || [];
  state.compProgress = progress.data || [];
  state.leaderboard  = leaderboard.data || [];
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
      el('div', { class: 'text-lime text-4xl font-black tracking-tight mb-1' }, 'RIDD'),
      el('div', { class: 'text-xs text-battleship tracking-widest mb-6' }, 'SALES PLATFORM'),
      el('h1', { class: 'text-xl font-semibold mb-3' }, 'Configuration needed'),
      el('p', { class: 'text-battle-2 text-sm mb-4' },
        'Open ', el('code', { class: 'text-lime' }, 'index.html'),
        ' and paste your Supabase publishable key into the ',
        el('code', { class: 'text-lime' }, 'RIDD_CONFIG'), ' block at the top of the file.'),
      el('p', { class: 'text-battle-2 text-xs mb-6' },
        'Supabase Dashboard → Settings → API Keys → "Publishable and secret API keys" → Create new API keys'),
      el('div', { class: 'pt-4 border-t border-eerie3' },
        el('p', { class: 'text-xs text-battleship mb-3' }, 'Or explore the UI with mock data:'),
        el('a', {
          href: '?demo',
          class: 'inline-block px-5 py-2.5 rounded-xl bg-lime hover:bg-lime-600 text-eerie font-semibold text-sm transition',
        }, 'View demo →'),
      ),
    )));
}

function mountLoading() {
  mount(el('div', { class: 'min-h-screen flex items-center justify-center' },
    el('div', { class: 'flex items-center gap-3 text-battle-2' },
      el('span', { class: 'spinner' }),
      'Loading…'
    )));
}

function mountError(err) {
  mount(el('div', { class: 'min-h-screen flex items-center justify-center p-6' },
    el('div', { class: 'card p-6 max-w-lg' },
      el('h1', { class: 'text-lg font-semibold text-red-400 mb-2' }, 'Something went wrong'),
      el('pre', { class: 'text-xs text-battle-2 whitespace-pre-wrap' }, err.message || String(err)),
      el('button', {
        class: 'mt-4 px-4 py-2 rounded-lg bg-lime text-eerie font-semibold',
        onclick: () => location.reload(),
      }, 'Reload'))));
}

// ──────────────────────────────────────────────────────────────────────────
// AUTH (login / forgot password / set new password)
// ──────────────────────────────────────────────────────────────────────────
// Sign-up is intentionally absent: accounts are created when an admin invites
// a rep (Admin → Reps → Invite). The invite email contains a magic link that
// creates the auth row on first click; the rep can later set a password via
// "Forgot password?" → email reset link.
function mountAuth(opts = {}) {
  const initialMode = opts.mode || 'login'; // 'login' | 'forgot' | 'recover'
  const form = el('form', {
    class: 'card p-6 w-full max-w-sm flex flex-col gap-3',
    onsubmit: async (e) => {
      e.preventDefault();
      const email    = form.email?.value?.trim();
      const password = form.password?.value;
      const mode     = form.dataset.mode;

      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span>';
      try {
        if (mode === 'login') {
          const { error } = await supabase.auth.signInWithPassword({ email, password });
          if (error) throw error;
        } else if (mode === 'forgot') {
          const { error } = await supabase.auth.resetPasswordForEmail(email, {
            redirectTo: window.location.origin,
          });
          if (error) throw error;
          toast('Reset link sent — check your email.', 'success');
          form.dataset.mode = 'login';
          renderMode();
        } else if (mode === 'recover') {
          const { error } = await supabase.auth.updateUser({ password });
          if (error) throw error;
          toast('Password updated — signing you in.', 'success');
          // Strip the recovery hash so a refresh doesn't re-trigger this view,
          // then let onAuthStateChange route us into the app.
          history.replaceState(null, '', window.location.pathname + window.location.search);
          loadAndRender();
        }
      } catch (err) {
        toast(err.message || 'Auth failed', 'error');
      } finally {
        submitBtn.disabled = false;
        renderMode();
      }
    },
  });

  form.dataset.mode = initialMode;

  const heading    = el('h1', { class: 'text-xl font-semibold' });
  const subheading = el('p', { class: 'text-battle-2 text-sm mb-2' });
  const emailField = el('label', { class: 'block text-sm' },
    el('span', { class: 'text-battle-2 block mb-1' }, 'Email'),
    el('input', { name: 'email', type: 'email', required: true, class: 'w-full rounded-lg border px-3 py-2', placeholder: 'you@ridd.com' }));
  const passField  = el('label', { class: 'block text-sm' },
    el('span', { class: 'text-battle-2 block mb-1' }, 'Password'),
    el('input', { name: 'password', type: 'password', required: true, minlength: 6, class: 'w-full rounded-lg border px-3 py-2', placeholder: '••••••••' }));
  const submitBtn  = el('button', { type: 'submit', class: 'w-full rounded-lg bg-lime hover:bg-lime-600 text-eerie font-semibold py-2.5 transition' });
  const forgotBtn  = el('button', { type: 'button', class: 'text-xs text-battle-2 hover:text-lime transition',
    onclick: () => { form.dataset.mode = form.dataset.mode === 'login' ? 'forgot' : 'login'; renderMode(); } });

  function renderMode() {
    const mode = form.dataset.mode;
    if (mode === 'login') {
      heading.textContent    = 'Sign in';
      subheading.textContent = 'RIDD Sales Platform';
      emailField.style.display = 'block';
      passField.style.display  = 'block';
      passField.querySelector('input').required = true;
      submitBtn.textContent = 'Sign in';
      forgotBtn.textContent = 'Forgot password?';
      forgotBtn.style.display = '';
    } else if (mode === 'forgot') {
      heading.textContent    = 'Reset password';
      subheading.textContent = 'Enter your email and we’ll send you a reset link.';
      emailField.style.display = 'block';
      passField.style.display  = 'none';
      passField.querySelector('input').required = false;
      submitBtn.textContent = 'Send reset link';
      forgotBtn.textContent = 'Back to sign in';
      forgotBtn.style.display = '';
    } else if (mode === 'recover') {
      heading.textContent    = 'Set a new password';
      subheading.textContent = 'Enter the password you’d like to use from now on.';
      emailField.style.display = 'none';
      passField.style.display  = 'block';
      passField.querySelector('input').required = true;
      submitBtn.textContent = 'Update password';
      forgotBtn.style.display = 'none';
    }
  }

  form.append(
    el('div', { class: 'text-lime text-3xl font-black tracking-tight' }, CFG.COMPANY_NAME),
    el('div', { class: 'text-[10px] text-battleship tracking-[.22em] mb-2' }, CFG.COMPANY_TAGLINE),
    heading, subheading, emailField, passField, submitBtn, forgotBtn,
  );
  renderMode();

  mount(el('div', { class: 'min-h-screen flex items-center justify-center p-6' }, form));
}

// ──────────────────────────────────────────────────────────────────────────
// MAIN APP SHELL
// ──────────────────────────────────────────────────────────────────────────
const TAB_TITLES = {
  dashboard:    'SALES WAR ROOM',
  sales:        'SALES',
  pay:          'PAY STUB',
  competitions: 'COMPETITIONS',
  hall_of_fame: 'HALL OF FAME',
  indicators:   'INDICATORS',
  history:      'SALES HISTORY',
  admin:        'SETTINGS',
};

const HASH_MAP = { '#dashboard':'dashboard', '#sales':'sales', '#pay':'pay', '#history':'history', '#competitions':'competitions', '#halloffame':'hall_of_fame', '#indicators':'indicators', '#admin':'admin' };
const VIEW_TO_HASH = Object.fromEntries(Object.entries(HASH_MAP).map(([h,v])=>[v,h]));

function buildNotifDropdown() {
  const log = state.auditLog || [];
  const unread = log.filter(e => !state.notifLastSeen || e.timestamp > state.notifLastSeen);
  const actionLabels = { sale_logged:'New sale logged', audit:'Sale audited', staged:'Staged for payroll', payroll_processed:'Payroll processed' };

  const dropdown = el('div', { class: 'notif-dropdown card', style: { display: 'none' } },
    el('div', { class: 'flex items-center justify-between px-4 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, 'Notifications'),
      unread.length > 0 && el('button', {
        class: 'text-[10px] font-semibold', style: { color: 'var(--accent)' },
        onclick: () => { state.notifLastSeen = new Date().toISOString(); saveDemoData(); mountApp(); },
      }, 'Mark all read'),
    ),
    log.length === 0
      ? el('div', { class: 'px-4 py-6 text-center text-muted- text-xs' }, 'No activity yet')
      : el('div', { class: 'overflow-y-auto', style: { maxHeight: '320px' } },
          ...log.slice(0, 20).map(entry => {
            const isUnread = !state.notifLastSeen || entry.timestamp > state.notifLastSeen;
            return el('div', {
              class: 'px-4 py-2.5 border-b text-xs',
              style: { borderColor: 'var(--border)', fontWeight: isUnread ? '600' : '400', borderLeft: isUnread ? '3px solid var(--accent)' : '3px solid transparent' },
            },
              el('div', { class: 'flex items-center justify-between' },
                el('span', {}, actionLabels[entry.action] || entry.action),
                el('span', { class: 'text-muted- text-[10px]' }, timeAgo(entry.timestamp)),
              ),
              entry.customer_name && el('div', { class: 'text-muted- mt-0.5' }, entry.customer_name + (entry.new_status ? ' \u2192 ' + entry.new_status : '')),
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
              onclick: () => { state.view = 'history'; results.style.display = 'none'; input.value = ''; mountApp(); },
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
  const items = [
    ['dashboard', 'Dashboard', iconDashboard],
    ['sales', 'Sales', iconSales],
    ['pay', 'Pay', iconPay],
    ['history', 'History', iconHistory],
  ];
  const nav = el('nav', { class: 'mobile-nav' },
    ...items.map(([k, label, iconFn]) => el('button', {
      'data-active': state.view === k,
      onclick: () => { state.view = k; history.replaceState(null,'',VIEW_TO_HASH[k]||'#'+k); mountApp(); },
    }, iconFn(20), el('span', {}, label))),
    // "More" button
    (() => {
      const moreBtn = el('button', { 'data-active': ['competitions','hall_of_fame','admin'].includes(state.view) },
        iconGrid(20), el('span', {}, 'More'));
      const popover = el('div', { class: 'more-popover card', style: { display: 'none' } },
        ...[['competitions','Competitions',iconTrophy],['hall_of_fame','Hall of Fame',iconCrown],
            ...(isAdminRole(state.profile?.role) ? [['indicators','Indicators',iconChart]] : []),
            ...(isAdminRole(state.profile?.role) ? [['admin','Settings',iconGear]] : [])
        ].map(([k,label,iconFn]) => el('button', {
          class: 'flex items-center gap-3 w-full px-4 py-2.5 text-sm',
          style: state.view === k ? { color: 'var(--accent)', fontWeight: '600' } : { color: 'var(--text)' },
          onclick: () => { state.view = k; history.replaceState(null,'',VIEW_TO_HASH[k]||'#'+k); mountApp(); },
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
  const todayKey = new Date().toISOString().slice(0, 10);
  const EXCLUDE = new Set(['cancelled','nsf','not_payable','reschedule','rejected']);
  const todayCount = state.allSales.filter(s => s.sold_date === todayKey && !EXCLUDE.has(s.audit_status) && s.rep_id === state.profile.id).length;
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

function mountApp() {
  const isAdmin = isAdminRole(state.profile.role);

  // ── Single-column layout. The grid icon in the header is the nav menu. ──
  const shell = el('div', { class: 'min-h-screen flex flex-col' });

  // Nav items (admin reaches Settings via the gear icon, not the nav menu)
  const navItems = [
    ['dashboard',    'Dashboard',    iconDashboard()],
    ['sales',        'Sales',        iconSales()],
    ['pay',          'Pay',          iconPay()],
    ['history',      'History',      iconHistory()],
    ['competitions', 'Competitions', iconTrophy()],
    ['hall_of_fame', 'Hall of Fame', iconCrown()],
    ...(isAdmin ? [['indicators',   'Indicators',   iconChart()]] : []),
  ];

  // ── Nav dropdown menu (anchored to the grid icon) ──
  const navMenu = el('div', {
    class: 'nav-menu card',
    style: {
      position: 'absolute',
      top: 'calc(100% + 8px)',
      left: '0',
      minWidth: '240px',
      padding: '8px',
      display: 'none',
      zIndex: '40',
      boxShadow: 'var(--shadow-lg)',
    },
  },
    // Brand block at the top
    el('div', {
      class: 'px-3 py-2.5 mb-1 border-b',
      style: { borderColor: 'var(--border)' },
    },
      el('div', { class: 'text-lg font-black tracking-tight leading-none', style: { color: 'var(--accent)' } }, CFG.COMPANY_NAME),
      el('div', { class: 'text-[9px] tracking-[.22em] mt-0.5', style: { color: 'var(--text-subtle)' } }, CFG.COMPANY_TAGLINE),
    ),
    // Nav items
    ...navItems.map(([k, label, icon]) => el('button', {
      class: 'w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition',
      style: state.view === k
        ? { background: 'var(--accent)', color: 'var(--accent-text)' }
        : { color: 'var(--text)' },
      onmouseenter: (e) => { if (state.view !== k) e.currentTarget.style.background = 'var(--card-2)'; },
      onmouseleave: (e) => { if (state.view !== k) e.currentTarget.style.background = 'transparent'; },
      onclick: () => { state.view = k; history.replaceState(null, '', VIEW_TO_HASH[k] || '#' + k); mountApp(); },
    }, icon, el('span', {}, label))),
    // Footer: current user + sign out
    el('div', {
      class: 'px-3 pt-2 mt-1 border-t',
      style: { borderColor: 'var(--border)' },
    },
      el('div', { class: 'text-[11px] font-medium', style: { color: 'var(--text-muted)' } }, state.profile.full_name),
      el('div', { class: 'text-[10px] capitalize', style: { color: 'var(--text-subtle)' } },
        state.profile.role + (isAdmin ? '' : ' · ' + (state.offices.find(o => o.id === state.profile.office_id)?.name || 'no office'))),
      el('button', {
        class: 'mt-2 mb-1 text-xs transition hover:underline',
        style: { color: 'var(--text-muted)' },
        onclick: async () => {
          if (DEMO) { location.href = location.pathname; return; }
          await supabase.auth.signOut();
        },
      }, DEMO ? 'Exit demo' : 'Sign out'),
    ),
  );

  function toggleNavMenu() {
    const isOpen = navMenu.style.display === 'block';
    navMenu.style.display = isOpen ? 'none' : 'block';
    if (!isOpen) {
      // Close on outside click
      const closer = (e) => {
        if (!navMenu.contains(e.target) && !gridBtn.contains(e.target)) {
          navMenu.style.display = 'none';
          document.removeEventListener('mousedown', closer);
        }
      };
      setTimeout(() => document.addEventListener('mousedown', closer), 0);
    }
  }

  const gridBtn = el('button', {
    class: 'icon-btn show',
    onclick: toggleNavMenu,
    title: 'Menu',
  }, iconGrid(18));

  // ── Page header bar ──
  const pageHeader = el('header', {
    class: 'page-header flex items-center justify-between px-4 sm:px-6 py-3 sticky top-0 z-20',
    style: { position: 'sticky' },
  },
    el('div', { class: 'flex items-center gap-3 relative' },
      gridBtn,
      navMenu,
      el('h1', { class: 'text-base sm:text-lg font-bold tracking-wider' }, TAB_TITLES[state.view] || ''),
    ),
    buildSearchBar(),
    el('div', { class: 'flex items-center gap-2' },
      (() => {
        const unreadCount = (state.auditLog||[]).filter(e => !state.notifLastSeen || e.timestamp > state.notifLastSeen).length;
        const wrap = el('div', { class: 'relative' });
        const bellBtn = el('button', { class: 'icon-btn show', title: 'Notifications' }, iconBell(18));
        if (unreadCount > 0) {
          bellBtn.append(el('span', { class: 'notif-badge' }, unreadCount > 9 ? '9+' : String(unreadCount)));
        }
        const dd = buildNotifDropdown();
        bellBtn.onclick = () => {
          dd.style.display = dd.style.display === 'block' ? 'none' : 'block';
          if (dd.style.display === 'block') {
            setTimeout(() => document.addEventListener('mousedown', function closer(e) {
              if (!dd.contains(e.target) && !bellBtn.contains(e.target)) { dd.style.display='none'; document.removeEventListener('mousedown',closer); }
            }), 0);
          }
        };
        wrap.append(bellBtn, dd);
        return wrap;
      })(),
      el('button', {
        class: 'icon-btn show',
        onclick: toggleTheme,
        title: state.theme === 'light' ? 'Switch to dark' : 'Switch to light',
      }, state.theme === 'light' ? iconMoon(18) : iconSun(18)),
      isAdmin && el('button', {
        class: 'icon-btn show',
        onclick: () => { state.view = 'admin'; history.replaceState(null, '', VIEW_TO_HASH['admin'] || '#admin'); mountApp(); },
        title: 'Settings',
      }, iconGear(18)),
    ),
  );

  // ── Main content area ──
  const main = el('main', { class: 'flex-1 overflow-x-hidden' });
  const contentWrap = el('div', { class: 'p-4 sm:p-6' });
  main.append(pageHeader, contentWrap);

  shell.append(main);
  shell.append(mobileBottomNav());
  mount(shell);

  // Render the view's body
  const view = {
    dashboard:    viewDashboard,
    sales:        viewSales,
    pay:          viewPay,
    competitions: viewCompetitions,
    hall_of_fame: viewHallOfFame,
    indicators:   viewIndicators,
    history:      viewHistory,
    admin:        viewAdmin,
  }[state.view];
  const node = view();
  node.classList.add('fade-in');
  contentWrap.append(node);

  // Floating action button — always visible except in admin
  if (state.view !== 'admin') {
    document.querySelector('.fab')?.remove();
    const fab = el('button', { class: 'fab', onclick: () => openNewSaleModal() },
      el('span', { class: 'text-xl leading-none' }, '+'),
      el('span', {}, 'New Sale'),
    );
    document.body.append(fab);
  } else {
    document.querySelector('.fab')?.remove();
  }
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: DASHBOARD — "SALES WAR ROOM" (matches mockup)
// ──────────────────────────────────────────────────────────────────────────
function viewDashboard() {
  const isAdmin = isAdminRole(state.profile.role);
  const range = getDateRange(state.dashDateRange);
  // Scope: admin sees all reps, rep sees own
  const salesScope = isAdmin ? state.allSales : state.mySales;
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
  const isRenewal  = (sale) => renewalIds.has(sale.source_id);
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

  return el('div', { class: 'flex flex-col gap-5 max-w-6xl mx-auto' },

    // ─── Top row: + New Sale + date filter + office view ───
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('button', {
        class: 'rounded-xl px-5 py-2.5 text-sm font-bold transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => openNewSaleModal(),
      }, '+ New Sale'),

      // Spacer pushes the rest to the right
      el('div', { class: 'flex-1' }),

      // Date filter
      el('select', {
        class: 'rounded-xl px-3 py-2 text-xs font-medium cursor-pointer',
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
        el('input', { type: 'date', class: 'rounded-xl px-2 py-1.5 text-xs', value: state.dashCustomStart || '', onchange: e => { state.dashCustomStart = e.target.value; mountApp(); } }),
        el('span', { class: 'text-muted- text-xs' }, '→'),
        el('input', { type: 'date', class: 'rounded-xl px-2 py-1.5 text-xs', value: state.dashCustomEnd || '', onchange: e => { state.dashCustomEnd = e.target.value; mountApp(); } }),
      ),

      // Office view toggle (admin only)
      isAdmin && el('button', {
        class: 'px-3 py-2 text-xs rounded-xl border transition font-medium',
        style: state.dashOfficeView
          ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' }
          : { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => { state.dashOfficeView = !state.dashOfficeView; mountApp(); },
      }, state.dashOfficeView ? '✕ Office' : '🏢 Office'),
    ),

    // ─── Office dashboard (if toggled) ───
    isAdmin && state.dashOfficeView && officeDashboard(windowSales),

    // ─── Revenue Goal card — 3 bars: Total, New, Renewal ───
    (() => {
      const now2 = new Date();
      const dayOfYear = Math.floor((now2 - new Date(now2.getFullYear(), 0, 0)) / 86400000);
      const expectedPct = dayOfYear / 365;
      const paceMarkerPct = Math.min(100, expectedPct * 100);

      // Targets from Goals settings
      const g = state.companyGoal;
      const newTarget     = g.new_amount     || Math.round(g.amount * 0.75);
      const renewalTarget = g.renewal_amount || Math.round(g.amount * 0.25);

      // Progress bars for New and Renewal
      const progressBars = [
        { label: 'New Revenue',     actual: ytd.new,     target: newTarget,     color: '#0EA5E9' },
        { label: 'Renewal Revenue', actual: ytd.renewal, target: renewalTarget, color: '#9333EA' },
      ];

      // Total Revenue distribution bar (stacked: New | Renewal)
      const totalActual = ytd.total;
      const newPctOfTotal = totalActual > 0 ? (ytd.new / totalActual * 100) : 50;
      const renewalPctOfTotal = totalActual > 0 ? (ytd.renewal / totalActual * 100) : 50;

      return el('div', { class: 'card p-5' },
        el('div', { class: 'flex items-center justify-between mb-4 flex-wrap gap-3' },
          el('h2', { class: 'text-lg font-bold' }, 'Revenue Goal'),
          el('div', { class: 'flex items-center gap-3' },
            el('button', {
              class: 'px-3 py-1.5 text-xs rounded-lg border transition hover:brightness-95',
              style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
              onclick: () => openRepBreakdownModal(),
            }, 'Rep Breakdown'),
            el('div', { class: 'text-xs text-muted-' }, daysLeft + ' days left'),
          ),
        ),
        el('div', { class: 'flex flex-col gap-4' },

          // ── Total Revenue: distribution bar ──
          el('div', {},
            el('div', { class: 'flex items-center justify-between mb-1' },
              el('div', { class: 'flex items-center gap-2' },
                el('span', { class: 'text-sm font-semibold' }, 'Total Revenue'),
              ),
              el('span', { class: 'text-sm font-bold tabular-nums' }, fmt.usd0(totalActual)),
            ),
            // Stacked bar
            el('div', { class: 'goal-track flex overflow-hidden', style: { position: 'relative' } },
              el('div', {
                style: { background: '#0EA5E9', height: '100%', width: newPctOfTotal.toFixed(1) + '%', transition: 'width .3s', borderRadius: '999px 0 0 999px' },
                title: 'New: ' + fmt.usd0(ytd.new) + ' (' + newPctOfTotal.toFixed(1) + '%)',
              }),
              el('div', {
                style: { background: '#9333EA', height: '100%', width: renewalPctOfTotal.toFixed(1) + '%', transition: 'width .3s', borderRadius: '0 999px 999px 0' },
                title: 'Renewal: ' + fmt.usd0(ytd.renewal) + ' (' + renewalPctOfTotal.toFixed(1) + '%)',
              }),
            ),
            // Legend
            el('div', { class: 'flex items-center gap-4 mt-1.5' },
              el('div', { class: 'flex items-center gap-1.5' },
                el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#0EA5E9' } }),
                el('span', { class: 'text-[11px]' }, 'New'),
                el('span', { class: 'text-[11px] font-semibold tabular-nums' }, fmt.usd0(ytd.new)),
                el('span', { class: 'text-[10px] text-muted-' }, '(' + newPctOfTotal.toFixed(0) + '%)'),
              ),
              el('div', { class: 'flex items-center gap-1.5' },
                el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: '#9333EA' } }),
                el('span', { class: 'text-[11px]' }, 'Renewal'),
                el('span', { class: 'text-[11px] font-semibold tabular-nums' }, fmt.usd0(ytd.renewal)),
                el('span', { class: 'text-[10px] text-muted-' }, '(' + renewalPctOfTotal.toFixed(0) + '%)'),
              ),
            ),
          ),

          // ── New Revenue + Renewal Revenue: progress bars toward target ──
          ...progressBars.map(bar => {
            const pct = bar.target > 0 ? Math.min(1, bar.actual / bar.target) : 0;
            const paceDiff = bar.target > 0 ? ((pct - expectedPct) / (expectedPct || 0.01) * 100) : 0;
            const paceAhead = paceDiff >= 0;
            return el('div', {},
              el('div', { class: 'flex items-center justify-between mb-1' },
                el('div', { class: 'flex items-center gap-2' },
                  el('div', { style: { width: '8px', height: '8px', borderRadius: '50%', background: bar.color } }),
                  el('span', { class: 'text-sm font-semibold' }, bar.label),
                  el('span', { class: 'text-sm font-bold', style: { color: bar.color } }, ' ' + fmt.pct(pct)),
                ),
                el('div', { class: 'flex items-center gap-2' },
                  el('span', { class: 'text-xs tabular-nums' },
                    el('span', { class: 'font-semibold' }, fmt.usd0(bar.actual)),
                    el('span', { class: 'text-muted-' }, ' / '),
                    el('span', { class: 'font-bold' }, fmt.usd0(bar.target)),
                  ),
                  el('span', {
                    class: 'text-[10px] font-semibold px-2 py-0.5 rounded-full whitespace-nowrap',
                    style: {
                      background: paceAhead ? 'rgba(141,198,63,.12)' : 'rgba(220,38,38,.08)',
                      color: paceAhead ? '#5F8A1F' : '#DC2626',
                    },
                  }, (paceAhead ? '+' : '') + paceDiff.toFixed(1) + '%'),
                ),
              ),
              el('div', { class: 'goal-track', style: { position: 'relative' } },
                el('div', { style: { background: bar.color, height: '100%', borderRadius: '999px', transition: 'width .3s', width: (pct * 100).toFixed(2) + '%' } }),
                el('div', {
                  style: {
                    position: 'absolute', top: '-3px', bottom: '-3px',
                    left: paceMarkerPct.toFixed(1) + '%',
                    width: '2px', background: '#DC2626', borderRadius: '2px',
                  },
                  title: 'Expected pace',
                }),
              ),
              el('div', { class: 'goal-ticks mt-1' },
                ...goalTicks(bar.target).map(t => el('span', {}, t)),
              ),
            );
          }),
        ),
      );
    })(),

    // ─── KPI grid (3 columns, 2 rows) ───
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-3' },
      kpiCard('Total Sales',   fmt.int(totalSalesCount), 'view all', () => { state.view = 'sales'; mountApp(); }),
      kpiCard('New Sales',     fmt.int(newSalesCount),   'view all', () => { state.view = 'sales'; mountApp(); }),
      kpiCard('Renewals',      fmt.int(renewalCount),    'view all', () => { state.view = 'history'; mountApp(); }),
    ),
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-3' },
      kpiCard('Total Revenue',   fmt.usd0(totalRevenue),   'all sales'),
      kpiCard('New Revenue',     fmt.usd0(newRevenue),     'excludes renewals'),
      kpiCard('Renewal Revenue', fmt.usd0(renewalRevenue), 'renewals only'),
    ),

    // ─── Split: Today's Sales (30%) | Leaderboard (70%) ───
    el('div', { class: 'grid grid-cols-1 lg:grid-cols-[3fr_7fr] gap-4' },
      todaysSalesPanel(windowSales, range),
      leaderboardSection(),
    ),
  );
}

function sumRev(rows) { return rows.reduce((a, s) => a + Number(s.revenue_amount || 0), 0); }

function kpiCard(label, value, sub, onclick) {
  return el('div', { class: 'card p-5' + (onclick ? ' cursor-pointer hover:brightness-95 transition' : ''), onclick },
    el('div', { class: 'text-[10px] text-muted- uppercase tracking-widest font-semibold' }, label),
    el('div', { class: 'text-3xl font-black mt-1 tabular-nums' }, value),
    el('div', { class: 'text-xs mt-2 font-medium', style: { color: onclick ? 'var(--accent)' : 'var(--text-muted)' } },
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
  const isAdmin = isAdminRole(state.profile.role);
  if (isAdmin) return state.companyGoal;
  const repGoal = Number(state.profile.annual_revenue_goal || 0);
  return { amount: repGoal > 0 ? repGoal : 250000, period: 'year' };
}
function goalYtdRevenue(isAdmin) {
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const scope = isAdmin ? state.allSales : state.mySales;
  const EXCLUDE_GOAL = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  const ytd = scope.filter(s => {
    if (EXCLUDE_GOAL.has(s.audit_status)) return false;
    return new Date(s.sold_date + 'T00:00') >= yearStart;
  });
  const renewalIds = new Set(state.sources.filter(s => s.is_renewal).map(s => s.id));
  const isR = s => renewalIds.has(s.source_id);
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
function computeLeaderboard(tab = 'total', range = null) {
  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile].filter(Boolean);
  const renewalIds = new Set(state.sources.filter(s => s.is_renewal).map(s => s.id));
  const isRenewalSale = s => renewalIds.has(s.source_id);

  // Sales to aggregate — counts every sale that isn't cancelled/nsf/not_payable/reschedule.
  // This way the leaderboard ticks up as soon as a rep logs a sale, before audit.
  const yearStart = new Date(new Date().getFullYear(), 0, 1);
  const EXCLUDE = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  const salesPool = state.allSales.filter(s => {
    if (EXCLUDE.has(s.audit_status)) return false;
    const d = new Date(s.sold_date + 'T00:00');
    if (range) return d >= range.start && d <= range.end;
    return d >= yearStart;
  });

  const rows = profiles.map(p => {
    let sales = salesPool.filter(s => s.rep_id === p.id);
    if (tab === 'new')      sales = sales.filter(s => !isRenewalSale(s));
    if (tab === 'renewals') sales = sales.filter(s =>  isRenewalSale(s));

    const count    = sales.length;
    const revenue  = sales.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
    const initial  = sales.reduce((a, s) => a + Number(s.initial_amount || 0), 0);
    const recurring= sales.reduce((a, s) => a + Number(s.monthly_amount || 0) * Number(s.contract_months || 0), 0);
    const acv      = sales.reduce((a, s) => a + Number(s.initial_amount || 0) + Number(s.monthly_amount || 0) * 12, 0);

    // MY% = count(12mo) / count(12+18+24mo)
    const c12     = sales.filter(s => Number(s.contract_months) === 12).length;
    const cMulti  = sales.filter(s => [12,18,24].includes(Number(s.contract_months))).length;
    const my_pct  = cMulti > 0 ? c12 / cMulti : 0;

    // REC MIX% = count(12,18,24) / count(12,18,24 + one-time)
    const cOneTime = sales.filter(s => !Number(s.contract_months) || Number(s.contract_months) <= 1).length;
    const rec_mix_pct = (cMulti + cOneTime) > 0 ? cMulti / (cMulti + cOneTime) : 0;

    return {
      rep_id: p.id,
      full_name: p.full_name,
      first_name: (p.full_name || '').split(' ')[0],
      avatar_url: p.avatar_url,
      initials: p.initials,
      office: state.offices.find(o => o.id === p.office_id)?.name || '',
      count, revenue, initial, recurring, acv, my_pct, rec_mix_pct,
    };
  });

  // Sort by active sort column (default: sales desc)
  const sortKey = state.dashLeaderSort;
  const keyMap = { sales: 'count', revenue: 'revenue', initial: 'initial', recurring: 'recurring', acv: 'acv', my_pct: 'my_pct', rec_mix_pct: 'rec_mix_pct' };
  const k = keyMap[sortKey] || 'count';
  rows.sort((a, b) => (b[k] || 0) - (a[k] || 0));
  return rows;
}

// ──────────────────────────────────────────────────────────────────────────
// BADGE SYSTEM — gamification chips shown on the leaderboard
// ──────────────────────────────────────────────────────────────────────────
const BADGE_DEFS = {
  first_blood: { label: 'First Blood',   emoji: '🩸', color: '#DC2626', desc: 'First sale of the day' },
  on_fire:     { label: 'On Fire',       emoji: '🔥', color: '#EA580C', desc: '5+ sales today' },
  hat_trick:   { label: 'Hat Trick',     emoji: '⚡', color: '#9333EA', desc: '3 sales in a day' },
  multi_year:  { label: 'Multi-Year',    emoji: '📅', color: '#059669', desc: '3+ multi-year contracts this week' },
  record_watch:{ label: 'Record Watch',  emoji: '👀', color: '#CA8A04', desc: 'Within 80% of your personal best day' },
  new_record:  { label: 'NEW RECORD',    emoji: '🏆', color: '#8DC63F', desc: 'Just broke your personal best day!' },
};

// Returns a map { rep_id: ['first_blood', 'big_fish', ...] }
function computeBadges() {
  const badges = {};
  const add = (repId, code) => {
    if (!badges[repId]) badges[repId] = new Set();
    badges[repId].add(code);
  };

  const today = new Date();
  const todayKey = today.toISOString().slice(0, 10);
  const startOfDay = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const weekStart = new Date(startOfDay); weekStart.setDate(weekStart.getDate() - weekStart.getDay());

  const approvedOrPending = (s) =>
    ['serviced','pending','approved'].includes(s.audit_status);

  // Sales today
  const salesToday = state.allSales.filter(s => s.sold_date === todayKey);
  const salesThisWeek = state.allSales.filter(s => new Date(s.sold_date + 'T00:00') >= weekStart);

  // First Blood — the earliest sale logged today
  if (salesToday.length) {
    const sorted = [...salesToday].sort((a, b) => {
      const ta = new Date(a.created_at || a.sold_date).getTime();
      const tb = new Date(b.created_at || b.sold_date).getTime();
      return ta - tb;
    });
    const firstBlood = sorted[0];
    if (firstBlood) add(firstBlood.rep_id, 'first_blood');
  }

  // Per-rep badges
  const byRep = groupBy(state.allSales, s => s.rep_id);
  for (const [repId, repSales] of Object.entries(byRep)) {
    const repToday = repSales.filter(s => s.sold_date === todayKey && approvedOrPending(s));
    const repWeek  = repSales.filter(s => new Date(s.sold_date + 'T00:00') >= weekStart && approvedOrPending(s));

    // On Fire — 5+ sales today
    if (repToday.length >= 5) add(repId, 'on_fire');

    // Hat Trick — 3+ sales today
    if (repToday.length >= 3) add(repId, 'hat_trick');

    // Multi-Year — 3+ multi-year contracts this week
    if (repWeek.filter(s => [18, 24].includes(Number(s.contract_months))).length >= 3) add(repId, 'multi_year');

    // Record Watch / New Record — today vs their personal best day
    const records = computeRepRecords(repId, repSales);
    if (records.bestDay.revenue > 0 && repToday.length > 0) {
      const todayRevenue = repToday.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
      if (todayRevenue > records.bestDay.revenue) {
        add(repId, 'new_record');
      } else if (todayRevenue >= records.bestDay.revenue * 0.80) {
        add(repId, 'record_watch');
      }
    }
  }

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
    if (desc)  tip.append(el('span', { class: 'desc' }, desc));
    tip.classList.add('show');

    // Position above the target, centered horizontally
    const rect = target.getBoundingClientRect();
    // We need the tooltip size after content is set
    tip.style.left = '0px';
    tip.style.top  = '0px';
    const tRect = tip.getBoundingClientRect();
    const left = rect.left + rect.width / 2 - tRect.width / 2;
    const top  = rect.top - tRect.height - 10;
    // Clamp to viewport
    const clampedLeft = Math.max(8, Math.min(left, window.innerWidth - tRect.width - 8));
    tip.style.left = clampedLeft + 'px';
    tip.style.top  = top + 'px';
  };
  const hideTip = () => {
    if (_tooltipEl) _tooltipEl.classList.remove('show');
  };
  target.addEventListener('mouseenter', showTip);
  target.addEventListener('mouseleave', hideTip);
  target.addEventListener('focus', showTip);
  target.addEventListener('blur', hideTip);
}

// ──────────────────────────────────────────────────────────────────────────
// REP PROFILE MODAL — click a rep name on the leaderboard
// ──────────────────────────────────────────────────────────────────────────
function openRepProfileModal(repId) {
  const profile = state.allProfiles.find(p => p.id === repId) || state.profile;
  const repSales = state.allSales.filter(s => s.rep_id === repId);
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

    // Avatar + name + badges
    el('div', { class: 'flex items-center gap-4 mb-5' },
      avatarNode(profile.avatar_url, profile.initials, 'w-16 h-16 text-lg'),
      el('div', { class: 'flex-1' },
        el('div', { class: 'text-xl font-bold flex items-center gap-2 flex-wrap' },
          profile.full_name,
          ...repBadges.map(code => badgeChip(code)),
        ),
        el('div', { class: 'text-xs text-muted- mt-0.5 capitalize' },
          profile.role + ' · ' + (profile.email || ''),
        ),
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
  // Sort by logged time desc (most recent first)
  const rows = [...windowSales].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : new Date(a.sold_date).getTime();
    const tb = b.created_at ? new Date(b.created_at).getTime() : new Date(b.sold_date).getTime();
    return tb - ta;
  });

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
    const init = Number(s.initial_amount || 0);
    const rec  = Number(s.monthly_amount || 0);
    if (s.pay_per_service) {
      return init + Number(s.num_services || 0) * rec;
    }
    return init + rec * 12;
  };

  // Resolve contract type name — prefer contract_type_id, fallback to contract_months
  const contractTypeName = (s) => {
    if (s.contract_type_id) {
      const ct = state.contractTypes.find(c => c.id === s.contract_type_id);
      if (ct) return ct.name;
    }
    const m = Number(s.contract_months);
    if (m === 0) return 'One Time Service';
    if (m === 12) return '12 Months';
    if (m === 18) return '18 Months';
    if (m === 24) return '24 Months';
    return '—';
  };

  return el('div', { class: 'card overflow-hidden flex flex-col' },
    header,
    el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-[12px]' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
          el('tr', {},
            el('th', { class: 'text-left pl-4 pr-2 py-1.5 font-semibold' }, 'Time'),
            el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Rep'),
            el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Service'),
            el('th', { class: 'text-left px-2 py-1.5 font-semibold' }, 'Contract'),
            el('th', { class: 'text-right pr-4 pl-2 py-1.5 font-semibold' }, 'ACV'),
          ),
        ),
        el('tbody', {},
          rows.map(s => {
            const rep = state.allProfiles.find(p => p.id === s.rep_id) || state.profile;
            const first = (rep?.full_name || '').split(' ')[0];
            const timeStr = s.created_at
              ? new Date(s.created_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
              : '—';
            const svcName = nameFromId(state.serviceTypes, s.service_type_id);
            const ctName  = contractTypeName(s);
            return el('tr', { class: 'border-t border-' },
              el('td', { class: 'pl-4 pr-2 py-2 text-muted- tabular-nums text-[11px] whitespace-nowrap' }, timeStr),
              el('td', { class: 'px-2 py-2' },
                el('div', { class: 'flex items-center gap-1.5' },
                  avatarNode(rep?.avatar_url, rep?.initials, 'w-5 h-5 text-[8px]'),
                  el('span', { class: 'font-medium' }, first),
                ),
              ),
              el('td', { class: 'px-2 py-2 text-muted- truncate max-w-[140px]' }, svcName),
              el('td', { class: 'px-2 py-2 text-muted- whitespace-nowrap' }, ctName),
              el('td', { class: 'pr-4 pl-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap' }, fmt.usd0(saleAcv(s))),
            );
          }),
        ),
      ),
    ),
  );
}

function leaderboardSection() {
  const rows = computeLeaderboard(state.dashLeaderTab);
  const empty = rows.every(r => r.count === 0);
  const repBadges = computeBadges();

  const setSort = (k) => { state.dashLeaderSort = k; mountApp(); };
  const sortIndicator = (k) => state.dashLeaderSort === k ? '↓ ' : '';

  return el('div', { class: 'card overflow-hidden' },
    // Header with tabs
    el('div', { class: 'flex items-center justify-between px-4 py-3 flex-wrap gap-3 border-b border-' },
      el('h2', { class: 'text-base font-bold' }, 'Leaderboard'),
      el('div', { class: 'pill-tabs' },
        ...[['total','Total'],['new','New'],['renewals','Renewals']].map(([k, label]) =>
          el('button', {
            'data-active': state.dashLeaderTab === k,
            onclick: () => { state.dashLeaderTab = k; mountApp(); },
          }, label),
        ),
      ),
    ),
    // Table
    el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-[12px]' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
          el('tr', {},
            el('th', { class: 'text-left pl-4 pr-1 py-2 w-8' }, '#'),
            el('th', { class: 'text-left px-2 py-2' }, 'Rep'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', onclick: () => setSort('sales') }, sortIndicator('sales') + 'Sales'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', onclick: () => setSort('revenue') }, sortIndicator('revenue') + 'Revenue'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', onclick: () => setSort('initial') }, sortIndicator('initial') + 'Initial'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', onclick: () => setSort('recurring') }, sortIndicator('recurring') + 'Recurring'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', onclick: () => setSort('acv') }, sortIndicator('acv') + 'ACV'),
            el('th', { class: 'text-right px-2 py-2 cursor-pointer select-none hover:text-default', title: '12-month contracts / 12+18+24-month contracts', onclick: () => setSort('my_pct') }, sortIndicator('my_pct') + 'MY %'),
            el('th', { class: 'text-right pl-2 pr-4 py-2 cursor-pointer select-none hover:text-default', title: '12/18/24-mo contracts / (contracts + one-time services)', onclick: () => setSort('rec_mix_pct') }, sortIndicator('rec_mix_pct') + 'Rec Mix %'),
          ),
        ),
        el('tbody', {},
          rows.map((r, i) => {
            const isMe = r.rep_id === state.profile.id;
            return el('tr', {
              class: 'border-t border- hover:brightness-95 transition',
              style: isMe ? { background: 'rgba(141,198,63,.08)' } : {},
            },
              el('td', { class: 'pl-4 pr-1 py-2 font-bold tabular-nums' + (i === 0 && r.count > 0 ? ' text-base' : ''), style: i === 0 && r.count > 0 ? { color: 'var(--accent)' } : {} }, i + 1),
              el('td', { class: 'px-2 py-2' },
                el('div', {
                  class: 'flex items-center gap-2 cursor-pointer',
                  onclick: () => openRepProfileModal(r.rep_id),
                  title: 'View ' + r.first_name + '\'s profile',
                },
                  avatarNode(r.avatar_url, r.initials, 'w-7 h-7 text-[9px]'),
                  el('div', { class: 'flex-1 min-w-0' },
                    el('div', { class: 'font-semibold flex items-center gap-1 flex-wrap hover:underline' },
                      r.first_name,
                      ...[...(repBadges[r.rep_id] || [])].map(code => badgeChip(code)),
                    ),
                  ),
                ),
              ),
              r.count === 0
                ? el('td', { class: 'px-2 py-2 text-subtle- italic', colspan: 7 }, 'No sales')
                : [
                    el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.int(r.count)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold' }, fmt.usd0(r.revenue)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' }, fmt.usd0(r.initial)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' }, fmt.usd0(r.recurring)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums text-muted-' }, fmt.usd0(r.acv)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.pct(r.my_pct)),
                    el('td', { class: 'pl-2 pr-4 py-2 text-right tabular-nums' }, fmt.pct(r.rec_mix_pct)),
                  ],
            );
          }),
        ),
      ),
    ),
    empty && el('div', { class: 'px-5 py-3 text-xs text-muted- border-t border-' }, 'Year-to-date leaderboard · waiting on approved sales'),
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

// ──────────────────────────────────────────────────────────────────────────
// VIEW: SALES — pending queue (+ new sale opens modal via FAB)
// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// VIEW: SALES — spreadsheet-style table matching the RIDD SALES sheet
//   Rep:   sees only their own pending / below-min / nsf sales
//   Admin: sees every rep's pending sales + inline audit dropdown per row
// ──────────────────────────────────────────────────────────────────────────
function viewSales() {
  const isAdmin = isAdminRole(state.profile.role);
  const source  = isAdmin ? state.allSales : state.mySales;
  // Include: pending, below_min, nsf, AND audited-but-not-staged sales so admin can stage them
  const pending = source.filter(s => {
    if (s.audit_status === 'pending' || s.audit_status === 'below_minimums' || s.audit_status === 'nsf') return true;
    if (s.audit_status === 'serviced' && !s.staged_for_payroll) return true;
    return false;
  });
  // Sort: oldest first (audit FIFO)
  pending.sort((a, b) => {
    const ta = new Date(a.created_at || a.sold_date).getTime();
    const tb = new Date(b.created_at || b.sold_date).getTime();
    return ta - tb;
  });

  // Apply user filters on top
  const sf = state.salesFilters;
  let filtered = pending;
  if (sf.dateStart) filtered = filtered.filter(s => s.sold_date >= sf.dateStart);
  if (sf.dateEnd) filtered = filtered.filter(s => s.sold_date <= sf.dateEnd);
  if (sf.status) filtered = filtered.filter(s => s.audit_status === sf.status);
  if (sf.repId) filtered = filtered.filter(s => s.rep_id === sf.repId);
  if (sf.contractTypeId) filtered = filtered.filter(s => s.contract_type_id === Number(sf.contractTypeId));

  return el('div', { class: 'flex flex-col gap-5 max-w-6xl mx-auto' },
    // ── Full-width primary CTA (matches dashboard) ──
    el('button', {
      class: 'w-full rounded-2xl py-4 text-base font-bold transition hover:brightness-95',
      style: { background: 'var(--accent)', color: 'var(--accent-text)' },
      onclick: () => openNewSaleModal(),
    }, '+ New Sale'),

    // ── Filter bar ──
    el('div', { class: 'card p-3 flex flex-wrap gap-2 items-center' },
      el('input', { type: 'date', class: 'rounded-lg border px-3 py-2 text-xs', value: sf.dateStart, onchange: e => { sf.dateStart = e.target.value; mountApp(); } }),
      el('input', { type: 'date', class: 'rounded-lg border px-3 py-2 text-xs', value: sf.dateEnd, onchange: e => { sf.dateEnd = e.target.value; mountApp(); } }),
      el('select', { class: 'rounded-lg border px-3 py-2 text-xs', onchange: e => { sf.status = e.target.value; mountApp(); } },
        el('option', { value: '', selected: !sf.status }, 'All statuses'),
        ...['pending','serviced','below_minimums','cancelled','nsf','not_payable','reschedule'].map(s =>
          el('option', { value: s, selected: sf.status === s }, s.replace('_',' '))),
      ),
      isAdmin && el('select', { class: 'rounded-lg border px-3 py-2 text-xs', onchange: e => { sf.repId = e.target.value; mountApp(); } },
        el('option', { value: '', selected: !sf.repId }, 'All reps'),
        ...(state.allProfiles||[]).map(p => el('option', { value: p.id, selected: sf.repId === p.id }, p.full_name)),
      ),
      el('select', { class: 'rounded-lg border px-3 py-2 text-xs', onchange: e => { sf.contractTypeId = e.target.value; mountApp(); } },
        el('option', { value: '', selected: !sf.contractTypeId }, 'All contracts'),
        ...state.contractTypes.map(ct => el('option', { value: ct.id, selected: sf.contractTypeId == ct.id }, ct.name)),
      ),
      (sf.dateStart || sf.dateEnd || sf.status || sf.repId || sf.contractTypeId) && el('button', {
        class: 'text-xs font-semibold px-3 py-2', style: { color: 'var(--accent)' },
        onclick: () => { Object.assign(sf, { dateStart:'', dateEnd:'', status:'', repId:'', contractTypeId:'' }); mountApp(); },
      }, 'Clear filters'),
    ),

    // ── Table ──
    filtered.length === 0
      ? el('div', { class: 'card p-10 text-center text-muted- text-sm' },
          isAdmin ? 'All caught up \u2014 no sales waiting for audit.' : 'Nothing pending. Log a sale with the + New Sale button.')
      : salesTable(filtered, { isAdmin }),
  );
}

function salesTable(rows, { isAdmin = false } = {}) {
  const cell = (content, extraClass = '') => el('td', {
    class: 'px-2 py-2 ' + extraClass,
  }, content);

  const headerCell = (label, extraClass = '') => el('th', {
    class: 'text-left px-2 py-2 font-semibold whitespace-nowrap ' + extraClass,
  }, label);

  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'scroll-x' },
      el('table', { class: 'w-full text-[12px]' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted- bg-card2-' },
          el('tr', {},
            headerCell('Customer',    'pl-4'),
            headerCell('Cust #'),
            isAdmin && headerCell('Rep'),
            headerCell('Office'),
            headerCell('Service Type'),
            headerCell('Contract'),
            headerCell('Source'),
            el('th', { class: 'text-right px-2 py-2 font-semibold whitespace-nowrap' }, 'Initial'),
            el('th', { class: 'text-right px-2 py-2 font-semibold whitespace-nowrap' }, 'Monthly'),
            el('th', { class: 'text-right px-2 py-2 font-semibold whitespace-nowrap' }, 'Revenue'),
            headerCell('Sold'),
            headerCell('Status'),
            headerCell('Notes'),
            isAdmin && el('th', { class: 'text-left pl-2 pr-4 py-2 font-semibold whitespace-nowrap' }, 'Audit'),
          ),
        ),
        el('tbody', {},
          rows.map(s => {
            const rep = state.allProfiles.find(p => p.id === s.rep_id) || state.profile;
            const first = (rep?.full_name || '').split(' ')[0];
            const ctName = contractTypeLabelForSale(s);
            const noteTxt = s.notes || '';
            return el('tr', { class: 'border-t border- hover:brightness-95 transition' },
              el('td', { class: 'pl-4 pr-2 py-2 font-medium whitespace-nowrap max-w-[160px] truncate', title: s.customer_name }, s.customer_name),
              cell(el('span', { class: 'text-muted- tabular-nums' }, s.customer_number || '—'), 'whitespace-nowrap'),
              isAdmin && cell(
                el('div', { class: 'flex items-center gap-1.5' },
                  avatarNode(rep?.avatar_url, rep?.initials, 'w-5 h-5 text-[8px]'),
                  el('span', { class: 'text-[11px] font-medium whitespace-nowrap' }, first),
                ),
              ),
              cell(el('span', { class: 'text-muted- whitespace-nowrap' }, state.offices.find(o => o.id === s.office_id)?.name || '—')),
              cell(el('span', { class: 'text-muted- max-w-[140px] truncate inline-block align-bottom', title: nameFromId(state.serviceTypes, s.service_type_id) }, nameFromId(state.serviceTypes, s.service_type_id))),
              cell(el('span', { class: 'text-muted- whitespace-nowrap' }, ctName)),
              cell(el('span', { class: 'text-muted- whitespace-nowrap max-w-[110px] truncate inline-block align-bottom', title: nameFromId(state.sources, s.source_id) }, nameFromId(state.sources, s.source_id))),
              el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap' }, fmt.usd(s.initial_amount)),
              el('td', { class: 'px-2 py-2 text-right tabular-nums whitespace-nowrap text-muted-' }, fmt.usd(s.monthly_amount)),
              el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold whitespace-nowrap' }, fmt.usd(s.revenue_amount)),
              cell(el('span', { class: 'text-muted- tabular-nums whitespace-nowrap' }, fmt.dateShort(s.sold_date))),
              cell(statusChip(s.audit_status)),
              cell(
                el('div', { class: 'flex items-center gap-1' },
                  noteTxt
                    ? el('span', { class: 'text-muted- italic max-w-[140px] truncate inline-block align-bottom', title: noteTxt }, noteTxt)
                    : el('span', { class: 'text-subtle-' }, '\u2014'),
                  s.audit_note && el('span', {
                    class: 'inline-block w-2 h-2 rounded-full flex-shrink-0',
                    style: { background: 'var(--accent)' },
                    title: 'Audit note: ' + s.audit_note + (s.audit_note_by ? ' \u2014 ' + s.audit_note_by : ''),
                  }),
                ),
              ),
              isAdmin && el('td', { class: 'pl-2 pr-4 py-2 whitespace-nowrap' },
                auditSelect(s.id),
              ),
            );
          }),
        ),
      ),
    ),
  );
}

// Compact audit dropdown for the table row.
// If sale is already audited (serviced/below_min) and not staged, the primary action is "Stage for Payroll".
function auditSelect(saleId) {
  const sale = state.allSales.find(x => x.id === saleId) || state.mySales.find(x => x.id === saleId);
  const alreadyAudited = sale && (sale.audit_status === 'serviced' || sale.audit_status === 'below_minimums') && !sale.staged_for_payroll;

  const wrap = el('div', { class: 'relative' });
  const notePopover = el('div', { class: 'card absolute right-0 top-full mt-1 p-3 z-30', style: { display: 'none', minWidth: '220px', boxShadow: 'var(--shadow-lg)' } });

  const sel = el('select', {
    class: 'rounded-lg border px-2 py-1.5 text-xs font-medium cursor-pointer',
    style: { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' },
    onchange: (e) => {
      const val = e.target.value;
      if (!val) return;
      if (val === 'stage') {
        stageSale(saleId);
        e.target.value = '';
        return;
      }
      // Show note popover for audit actions
      notePopover.innerHTML = '';
      const noteInput = el('textarea', {
        class: 'w-full rounded-lg border px-2 py-1.5 text-xs', rows: '2',
        placeholder: 'Audit note (optional)...',
        style: { resize: 'vertical' },
      });
      notePopover.append(
        el('div', { class: 'text-[10px] font-semibold mb-1.5 uppercase tracking-wider text-muted-' }, 'Audit Note'),
        noteInput,
        el('div', { class: 'flex gap-2 mt-2' },
          el('button', {
            class: 'px-3 py-1.5 rounded-lg text-xs font-semibold',
            style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: () => { auditSale(saleId, val, noteInput.value.trim()); },
          }, 'Confirm'),
          el('button', {
            class: 'px-3 py-1.5 rounded-lg text-xs text-muted-',
            onclick: () => { notePopover.style.display = 'none'; sel.value = ''; },
          }, 'Cancel'),
        ),
      );
      notePopover.style.display = 'block';
      setTimeout(() => noteInput.focus(), 0);
      e.target.value = '';
    },
  },
    el('option', { value: '' }, alreadyAudited ? 'Stage \u25be' : 'Audit \u25be'),
    alreadyAudited && el('option', { value: 'stage' }, '\u2b50 Stage for Payroll'),
    el('option', { value: 'serviced' },       alreadyAudited ? 'Re-mark Serviced' : 'Mark Serviced'),
    el('option', { value: 'below_minimums' }, 'Below Minimums'),
    el('option', { value: 'cancelled' },      'Cancelled'),
    el('option', { value: 'nsf' },            'NSF'),
    el('option', { value: 'not_payable' },    'Not Payable'),
    el('option', { value: 'reschedule' },     'Reschedule'),
  );
  wrap.append(sel, notePopover);
  return wrap;
}

// Resolve contract type label for a sale (uses contract_type_id if available)
function contractTypeLabelForSale(s) {
  if (s.contract_type_id) {
    const ct = state.contractTypes.find(c => c.id === s.contract_type_id);
    if (ct) return ct.name;
  }
  const m = Number(s.contract_months);
  if (m === 0)  return 'One Time';
  if (m === 12) return '12 Months';
  if (m === 18) return '18 Months';
  if (m === 24) return '24 Months';
  return '—';
}

// ──────────────────────────────────────────────────────────────────────────
// (openNewSaleModal is defined below — Sales Log modal matching the mockup)
// ──────────────────────────────────────────────────────────────────────────

function openRepBreakdownModal() {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const isAdmin = isAdminRole(state.profile.role);
  const goal = getGoalForContext();
  const yearStart = new Date(new Date().getFullYear(), 0, 1);

  // Aggregate YTD revenue per rep
  const source = isAdmin ? state.allSales : state.mySales;
  const approvedYtd = source.filter(s => {
    if (!['approved','serviced'].includes(s.audit_status)) return false;
    return new Date(s.sold_date + 'T00:00') >= yearStart;
  });
  const byRep = {};
  for (const s of approvedYtd) {
    if (!byRep[s.rep_id]) byRep[s.rep_id] = { id: s.rep_id, name: '', revenue: 0, count: 0 };
    byRep[s.rep_id].revenue += Number(s.revenue_amount || 0);
    byRep[s.rep_id].count += 1;
  }
  // Resolve names from leaderboard
  for (const rep of Object.values(byRep)) {
    const lb = state.leaderboard.find(r => r.rep_id === rep.id);
    rep.name = lb?.full_name || (rep.id === state.profile.id ? state.profile.full_name : 'Rep');
  }
  const rows = Object.values(byRep).sort((a, b) => b.revenue - a.revenue);
  const totalYtd = rows.reduce((a, r) => a + r.revenue, 0);

  const modal = el('div', { class: 'card w-full max-w-2xl p-6 my-8' },
    el('div', { class: 'flex items-center justify-between mb-1' },
      el('h2', { class: 'text-xl font-bold' }, 'Rep Breakdown'),
      el('button', { class: 'text-2xl text-muted-', onclick: () => overlay.remove() }, '×'),
    ),
    el('p', { class: 'text-xs text-muted- mb-4' }, 'Year-to-date contribution toward the ' + fmt.usd0(goal.amount) + ' goal'),
    rows.length === 0
      ? el('div', { class: 'p-6 text-center text-muted- text-sm' }, 'No approved sales yet this year.')
      : el('div', { class: 'flex flex-col gap-2' },
          rows.map((r, i) => {
            const pct = goal.amount > 0 ? r.revenue / goal.amount : 0;
            return el('div', { class: 'card-2 p-4 rounded-xl border border-' },
              el('div', { class: 'flex items-center justify-between mb-2' },
                el('div', { class: 'flex items-center gap-3' },
                  el('span', { class: 'text-xs font-bold tabular-nums text-muted-' }, '#' + (i + 1)),
                  el('span', { class: 'font-semibold' }, r.name),
                  el('span', { class: 'text-xs text-muted-' }, fmt.int(r.count) + ' sales'),
                ),
                el('div', { class: 'text-right' },
                  el('div', { class: 'text-sm font-bold tabular-nums' }, fmt.usd0(r.revenue)),
                  el('div', { class: 'text-[10px] text-muted-' }, fmt.pct(pct) + ' of goal'),
                ),
              ),
              el('div', { class: 'goal-track', style: { height: '6px' } },
                el('div', { class: 'goal-fill', style: { width: (pct * 100).toFixed(2) + '%' } }),
              ),
            );
          }),
        ),
    el('div', { class: 'flex items-center justify-between mt-4 pt-4 border-t border-' },
      el('span', { class: 'text-sm font-semibold' }, 'Total'),
      el('span', { class: 'text-lg font-bold tabular-nums', style: { color: 'var(--accent)' } }, fmt.usd0(totalYtd)),
    ),
  );

  overlay.append(modal);
  document.body.append(overlay);
}

// ──────────────────────────────────────────────────────────────────────────
// SALES LOG MODAL — matches the mockup exactly
// ──────────────────────────────────────────────────────────────────────────
function openNewSaleModal(defaultRepId) {
  const isAdmin = isAdminRole(state.profile.role);
  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile];
  // State captured inside the modal (for live footer + checkbox fields that aren't form-bound)
  const modalState = {
    rep_id:         defaultRepId || state.profile.id,
    paid_in_full:   false,
    is_commercial:  false,
    pay_per_service:false,
  };

  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Build a card-like modal with a sticky footer bar
  const card = el('div', { class: 'card w-full max-w-3xl my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } });

  // ── HEADER ──
  const repSelect = el('select', {
    class: 'rounded-lg border px-3 py-1.5 text-sm font-medium',
    disabled: !isAdmin,
    onchange: e => { modalState.rep_id = e.target.value; updateFooter(); },
  },
    ...profiles.map(p => el('option', { value: p.id, selected: p.id === modalState.rep_id }, p.full_name)),
  );

  const header = el('div', { class: 'flex items-center justify-between px-6 py-4 border-b border-' },
    el('div', { class: 'flex items-center gap-4' },
      el('h2', { class: 'text-lg font-bold' }, 'Sales Log'),
      repSelect,
    ),
    el('button', {
      class: 'rounded-lg border px-3 py-1.5 text-sm text-muted- hover:text-default transition',
      style: { borderColor: 'var(--border-2)' },
      onclick: () => overlay.remove(),
    }, '← Back'),
  );

  // ── FORM ──
  const mk = (label, input, opts = {}) => el('label', { class: 'block text-sm' + (opts.fullWidth ? ' sm:col-span-2' : '') },
    el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' }, label),
    input,
  );
  const inp = (name, attrs = {}) => el('input', { name, class: 'w-full rounded-lg border px-3 py-2.5 text-sm', ...attrs });
  const sel = (name, options, attrs = {}) => el('select', { name, class: 'w-full rounded-lg border px-3 py-2.5 text-sm', ...attrs },
    el('option', { value: '' }, '— select —'),
    ...options.map(o => el('option', { value: o.id, selected: attrs.value == o.id }, o.name)),
  );

  // Contract type dropdown (real RIDD categorical values). Default to 'Select Contract Type...'
  // The VALUE is the contract_type id; contract_months is derived via implied_months on submit.
  const contractTypeSelect = el('select', {
    name: 'contract_type_id',
    class: 'w-full rounded-lg border px-3 py-2.5 text-sm',
    required: true,
    onchange: () => { updateFooter(); rebuildServiceOptions(); checkValidity(); },
  },
    el('option', { value: '' }, 'Select Contract Type...'),
    ...state.contractTypes.map(ct => el('option', { value: ct.id }, ct.name)),
  );

  // The Service dropdown is filtered by contract type:
  //   "One Time Service" → only services whose name starts with "One Time"
  //   anything else      → only services whose name does NOT start with "One Time"
  //   no selection       → all services
  const serviceSelect = el('select', {
    name: 'service_type_id',
    class: 'w-full rounded-lg border px-3 py-2.5 text-sm',
    required: true,
    onchange: () => checkValidity(),
  });
  function rebuildServiceOptions() {
    const ctId   = Number(contractTypeSelect.value);
    const ct     = state.contractTypes.find(c => c.id === ctId);
    const isOneTime = ct?.name === 'One Time Service';
    const filtered = state.serviceTypes.filter(s => {
      if (!ct) return true;
      const startsOT = s.name.startsWith('One Time');
      return isOneTime ? startsOT : !startsOT;
    });
    const prevValue = serviceSelect.value;
    serviceSelect.innerHTML = '';
    serviceSelect.append(el('option', { value: '' }, 'Select Service...'));
    filtered.forEach(o => serviceSelect.append(el('option', { value: o.id }, o.name)));
    if (prevValue && filtered.some(s => String(s.id) === prevValue)) {
      serviceSelect.value = prevValue;
    } else {
      serviceSelect.value = '';
    }

    // One Time Service contracts have no recurring — lock and zero out that field.
    if (isOneTime) {
      modalState.pay_per_service = false;
      if (pps.checked) pps.checked = false;
      recurringInput.value = '0';
      recurringInput.disabled = true;
      recurringInput.style.opacity = '.5';
      recurringInput.style.cursor = 'not-allowed';
      recurringInput.required = false;
      pps.disabled = true;
      pps.parentElement && (pps.parentElement.style.opacity = '.5');
      renderRecurringHost();
    } else {
      recurringInput.disabled = false;
      recurringInput.style.opacity = '';
      recurringInput.style.cursor = '';
      pps.disabled = false;
      pps.parentElement && (pps.parentElement.style.opacity = '');
      recurringInput.required = !modalState.pay_per_service;
      renderRecurringHost();
    }
  }
  // Initial population happens at the bottom of the setup, after recurringInput/pps are declared.

  const initialInput = inp('initial_amount', {
    type: 'number', step: '0.01', min: 0, required: true, placeholder: '0',
    oninput: () => { updateFooter(); checkValidity(); },
  });

  // Recurring / Pay-Per-Service fields — swapped depending on PPS checkbox.
  // In PPS mode, the two fields replace the single recurring input with no
  // extra labels above — their labels become placeholders so the row keeps
  // the same height as the Initial ($) field next to it.
  const recurringInput = inp('monthly_amount', {
    type: 'number', step: '0.01', min: 0, required: true, placeholder: '0',
    oninput: () => { updateFooter(); checkValidity(); },
  });
  const numServicesInput = inp('num_services', {
    type: 'number', step: '1', min: 0, placeholder: '# of Services',
    oninput: () => { updateFooter(); checkValidity(); },
  });
  const amtPerServiceInput = inp('amount_per_service', {
    type: 'number', step: '0.01', min: 0, placeholder: 'Amount / Service',
    oninput: () => { updateFooter(); checkValidity(); },
  });

  const recurringHost = el('div', {});
  function renderRecurringHost() {
    recurringHost.innerHTML = '';
    if (modalState.pay_per_service) {
      numServicesInput.required = true;
      amtPerServiceInput.required = true;
      recurringInput.required = false;
      recurringHost.append(
        el('div', { class: 'grid grid-cols-2 gap-2' },
          numServicesInput,
          amtPerServiceInput,
        ),
      );
    } else {
      numServicesInput.required = false;
      amtPerServiceInput.required = false;
      recurringInput.required = true;
      recurringHost.append(recurringInput);
    }
  }

  const pps = el('input', {
    type: 'checkbox', class: 'accent-lime',
    tabindex: '-1',       // skip from tab order so Initial → Recurring is direct
    onchange: () => {
      modalState.pay_per_service = pps.checked;
      renderRecurringHost();
      updateFooter();
      checkValidity();
    },
  });

  const form = el('form', {
    class: 'p-6 overflow-y-auto flex-1',
    onsubmit: async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.innerHTML = '<span class="spinner"></span>';
      try {
        const data = Object.fromEntries(new FormData(form));
        const initial  = parseFloat(data.initial_amount) || 0;
        const monthly  = parseFloat(data.monthly_amount) || 0;
        const numSvcs  = parseFloat(data.num_services) || 0;
        const amtSvc   = parseFloat(data.amount_per_service) || 0;
        const ctId     = Number(data.contract_type_id);
        const ct       = state.contractTypes.find(c => c.id === ctId);
        const months   = ct?.implied_months != null ? ct.implied_months : 12; // default 12 for categorical
        const revenue  = modalState.pay_per_service
          ? initial + numSvcs * amtSvc
          : initial + monthly * months;

        const saleRow = {
          rep_id: modalState.rep_id,
          logged_by: state.profile.id,
          customer_name: data.customer_name,
          customer_number: data.customer_number || null,
          office_id: Number(data.office_id),
          service_type_id: Number(data.service_type_id),
          source_id: Number(data.source_id),
          contract_type_id: ctId,
          contract_months: months,
          initial_amount: initial,
          monthly_amount: modalState.pay_per_service ? amtSvc : monthly,
          num_services: modalState.pay_per_service ? numSvcs : null,
          pay_per_service: modalState.pay_per_service,
          paid_in_full: modalState.paid_in_full || (ct?.name === 'Paid in Full'),
          is_commercial: modalState.is_commercial || (ct?.name === 'Commercial'),
          revenue_amount: revenue,
          sold_date: data.sold_date,
          commission_date: data.commission_date || null,
          notes: data.notes || null,
          audit_status: 'pending',
          created_at: new Date().toISOString(),   // for the TIME column + badge logic
        };

        if (DEMO) {
          const id = Math.max(0, ...state.allSales.map(s => s.id || 0)) + 1;
          const row = { ...saleRow, id };
          if (row.rep_id === state.profile.id) state.mySales.unshift(row);
          state.allSales.unshift(row);
          logActivity('sale_logged', { sale_id: id, customer_name: row.customer_name, new_status: 'pending', rep_name: profiles.find(p => p.id === row.rep_id)?.full_name });
          toast('Sale logged', 'success');
      saveDemoData();
          overlay.remove();
          mountApp();
          return;
        }

        const { error } = await supabase.from('sales').insert(saleRow);
        if (error) throw error;
        toast('Sale logged — awaiting audit', 'success');
        await loadData();
        overlay.remove();
        mountApp();
      } catch (err) {
        toast(err.message || 'Failed to save', 'error');
        submitBtn.disabled = false;
        submitBtn.innerHTML = 'Log Sale';
      }
    },
  });

  const today = new Date().toISOString().slice(0, 10);

  form.append(
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-5' },
      mk('Customer Name', inp('customer_name', { required: true, placeholder: 'e.g. Jane Smith', oninput: () => checkValidity() })),
      mk('Customer #',    inp('customer_number', { required: true, placeholder: 'e.g. 10042', oninput: () => checkValidity() })),

      mk('Office', el('select', {
        name: 'office_id',
        class: 'w-full rounded-lg border px-3 py-2.5 text-sm',
        required: true,
        onchange: () => checkValidity(),
      },
        el('option', { value: '' }, 'Select Office...'),
        ...state.offices.map(o => el('option', { value: o.id }, o.name)),
      )),
      mk('Contract Type', contractTypeSelect),

      mk('Service', serviceSelect),
      mk('Source', el('select', {
        name: 'source_id',
        class: 'w-full rounded-lg border px-3 py-2.5 text-sm',
        required: true,
        onchange: () => checkValidity(),
      },
        el('option', { value: '' }, 'Select Source...'),
        ...state.sources.map(o => el('option', { value: o.id }, o.name)),
      )),

      mk('Initial ($)', initialInput),
      el('div', { class: 'block text-sm' },
        el('div', { class: 'flex items-center justify-between mb-1.5' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, 'Recurring ($)'),
          el('label', { class: 'flex items-center gap-1.5 text-[11px] text-muted- cursor-pointer select-none' },
            'Pay Per Service',
            pps,
          ),
        ),
        recurringHost,
      ),

      mk('Sold Date', inp('sold_date', { type: 'date', required: true, value: today })),
      mk('Commission Date', inp('commission_date', { type: 'date', value: today })),
    ),

    // Checkboxes side-by-side
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-3 mt-5' },
      checkboxCard('Paid in Full', 'No hold on backend — full commission is paid upfront', (v) => { modalState.paid_in_full = v; updateFooter(); }),
      checkboxCard('Commercial', 'ACV > $2,000 AND is a commercial property.', (v) => { modalState.is_commercial = v; updateFooter(); }),
    ),

    mk('Notes',
      el('textarea', { name: 'notes', class: 'w-full rounded-lg border px-3 py-2.5 text-sm', rows: 2, placeholder: 'Optional...' }),
      { fullWidth: true },
    ),
  );

  // ── FOOTER (sticky dark bar with live ACV + Projected Commission) ──
  const footerRep   = el('div', { class: 'text-base font-bold text-smoke' }, '—');
  const footerAcv   = el('div', { class: 'text-lg font-bold text-smoke tabular-nums' }, '$0.00');
  const footerComm  = el('div', { class: 'text-lg font-bold text-smoke tabular-nums' }, '$0.00');
  const footerStatus= el('div', { class: 'text-base font-bold text-smoke' }, 'Pending');
  const submitBtn   = el('button', {
    type: 'submit',
    class: 'fab',
    style: { position: 'static', padding: '12px 24px' },
  },
    el('span', {}, 'Log Sale'),
  );

  const footer = el('div', {
    class: 'px-6 py-4 grid grid-cols-[1fr_1fr_1.3fr_.7fr_auto] gap-4 items-center border-t border-',
    style: { background: 'var(--header-bg)', color: 'var(--header-text)' },
  },
    footerBlock('REP', footerRep),
    footerBlock('ACV', footerAcv),
    footerBlock('PROJECTED COMMISSION', footerComm),
    footerBlock('STATUS', footerStatus),
    submitBtn,
  );

  // Wire submit button to the form via requestSubmit()
  submitBtn.addEventListener('click', (e) => {
    e.preventDefault();
    if (!isFormValid()) { checkValidity(); return; }
    form.requestSubmit();
  });

  function updateFooter() {
    const initial  = parseFloat(initialInput.value) || 0;
    const monthly  = parseFloat(recurringInput.value) || 0;
    const numSvcs  = parseFloat(numServicesInput.value) || 0;
    const amtSvc   = parseFloat(amtPerServiceInput.value) || 0;
    const ctId     = Number(contractTypeSelect.value);
    const ct       = state.contractTypes.find(c => c.id === ctId);
    const months   = ct?.implied_months != null ? ct.implied_months : 12;
    // ACV logic:
    //   Non-PPS: initial + monthly*12
    //   PPS:     initial + (num_services * amt_per_service)
    const acv = modalState.pay_per_service
      ? initial + numSvcs * amtSvc
      : initial + monthly * 12;
    const revenue = modalState.pay_per_service
      ? initial + numSvcs * amtSvc
      : initial + monthly * months;
    // Use the new pricing engine for the projected commission preview
    const mockSale = { contract_type_id: ctId, audit_status: 'serviced' };
    const projRate = getCommissionRate(modalState.rep_id, mockSale);
    const projected = revenue * projRate;
    const repName = profiles.find(p => p.id === modalState.rep_id)?.full_name || '';
    footerRep.textContent   = repName;
    footerAcv.textContent   = fmt.usd(acv);
    footerComm.textContent  = fmt.usd(projected);
    footerStatus.textContent= 'Pending';
  }

  // Validate the 8 top fields: customer_name, customer_number, office_id, contract_type_id,
  // service_type_id, source_id, initial_amount, recurring (or num_services + amount)
  function isFormValid() {
    const vals = Object.fromEntries(new FormData(form));
    const required = ['customer_name', 'customer_number', 'office_id', 'contract_type_id', 'service_type_id', 'source_id', 'initial_amount'];
    for (const k of required) {
      if (!vals[k] || String(vals[k]).trim() === '') return false;
    }
    if (modalState.pay_per_service) {
      if (!vals.num_services || !vals.amount_per_service) return false;
    } else {
      if (vals.monthly_amount == null || String(vals.monthly_amount).trim() === '') return false;
    }
    return true;
  }

  function checkValidity() {
    const ok = isFormValid();
    submitBtn.disabled = !ok;
    submitBtn.style.opacity = ok ? '1' : '.45';
    submitBtn.style.cursor  = ok ? 'pointer' : 'not-allowed';
  }

  rebuildServiceOptions();
  renderRecurringHost();
  updateFooter();
  checkValidity();

  card.append(header, form, footer);
  overlay.append(card);
  document.body.append(overlay);
}

// Helper — render a compact label/value pair for the dark footer
function footerBlock(label, valueNode) {
  return el('div', {},
    el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'rgba(255,255,255,.6)' } }, label),
    valueNode,
  );
}

// Helper — big checkbox card (Paid in Full / Commercial)
function checkboxCard(title, desc, onChange) {
  const input = el('input', {
    type: 'checkbox',
    class: 'accent-lime w-4 h-4 mt-0.5 shrink-0',
    onchange: (e) => onChange(e.target.checked),
  });
  return el('label', {
    class: 'card-2 rounded-xl border border- p-4 flex items-start gap-3 cursor-pointer hover:brightness-95 transition',
  },
    input,
    el('div', { class: 'flex-1 min-w-0' },
      el('div', { class: 'font-semibold text-sm' }, title),
      el('div', { class: 'text-xs text-muted- mt-0.5' }, desc),
    ),
  );
}

// Legacy wrapper — kept so any old callers of newSaleForm() still work
function newSaleForm(onDone) {
  // This was the inline form; now we route everything through the modal.
  setTimeout(() => { openNewSaleModal(); onDone?.(); }, 0);
  return el('div', {});
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: PAY — replicates your PAY STUB layout
// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// PAY PERIOD HELPERS — 26 biweekly periods per year, anchored to Jan 1
// ──────────────────────────────────────────────────────────────────────────
function getPayPeriods(year) {
  const periods = [];
  const jan1 = new Date(year, 0, 1);
  for (let i = 0; i < 26; i++) {
    const start = new Date(year, 0, 1 + i * 14);
    const end   = new Date(year, 0, 1 + i * 14 + 13);
    const fmtOpt = { month: 'short', day: 'numeric' };
    periods.push({
      id: i + 1,
      start, end,
      label: `${start.toLocaleDateString('en-US', fmtOpt)} – ${end.toLocaleDateString('en-US', fmtOpt)}`,
      isoStart: start.toISOString().slice(0, 10),
      isoEnd:   end.toISOString().slice(0, 10),
    });
  }
  return periods;
}
function currentPayPeriodId(year) {
  const now = new Date();
  if (now.getFullYear() !== year) return year < now.getFullYear() ? 26 : 1;
  const periods = getPayPeriods(year);
  const p = periods.find(p => now >= p.start && now <= p.end);
  return p ? p.id : 1;
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: PAY — biweekly pay stub + commissionable accounts table
// ──────────────────────────────────────────────────────────────────────────
function viewPay() {
  const today = new Date();
  if (state.payYear == null) state.payYear = today.getFullYear();
  if (state.payPeriodId == null) state.payPeriodId = currentPayPeriodId(state.payYear);

  const years = [];
  for (let y = today.getFullYear() - 2; y <= today.getFullYear() + 1; y++) years.push(y);

  const periods = getPayPeriods(state.payYear);
  const period  = periods.find(p => p.id === state.payPeriodId) || periods[0];
  const nowPid  = currentPayPeriodId(today.getFullYear());

  const isAdmin = isAdminRole(state.profile.role);
  const repId   = state.profile.id;

  // Scope sales to this rep and this period (by sold_date)
  const inPeriod = (s) => {
    const d = new Date(s.sold_date + 'T00:00');
    return d >= period.start && d <= period.end && s.rep_id === repId;
  };
  const periodSales = (isAdmin ? state.allSales : state.mySales).filter(inPeriod);

  // Buckets
  const pending       = periodSales.filter(s => s.audit_status === 'pending');
  const servicedStaged= periodSales.filter(s => s.audit_status === 'serviced'       && s.staged_for_payroll);
  const belowStaged   = periodSales.filter(s => s.audit_status === 'below_minimums' && s.staged_for_payroll);
  const auditedUnstaged = periodSales.filter(s =>
    (s.audit_status === 'serviced' || s.audit_status === 'below_minimums') && !s.staged_for_payroll);

  const sumRev = (arr) => arr.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
  const pendingRev   = sumRev(pending);
  const servicedRev  = sumRev(servicedStaged);
  const belowRev     = sumRev(belowStaged);

  // Per-sale commission using the new getCommissionRate(repId, sale)
  // Serviced = full rate, Below Min = half rate (configurable in Pricing)
  const sumCommission = (arr) => arr.reduce((a, s) => a + Number(s.revenue_amount || 0) * getCommissionRate(repId, s), 0);
  const pendingPay = pending.reduce((a, s) => {
    // Estimate pending at the serviced rate (optimistic)
    const estSale = { ...s, audit_status: 'serviced' };
    return a + Number(s.revenue_amount || 0) * getCommissionRate(repId, estSale);
  }, 0);
  const salesPay   = sumCommission(servicedStaged);  // full commission
  const belowPay   = sumCommission(belowStaged);     // half commission (via getCommissionRate)

  // Close rate / multi-year backend
  const closeRateNum = (pending.length + servicedStaged.length + belowStaged.length);
  const closeRateDen = closeRateNum + periodSales.filter(s => s.audit_status === 'cancelled').length;
  const closeRate    = closeRateDen > 0 ? closeRateNum / closeRateDen : 0;
  const meetsCloseRate = closeRate >= Number(state.profile.close_rate_target);
  const closeRateBonus = meetsCloseRate ? servicedRev * 0.03 : 0;

  const multiYearBonus = servicedStaged
    .filter(s => [18, 24].includes(Number(s.contract_months)))
    .reduce((a, s) => a + Number(s.revenue_amount || 0) * 0.02, 0);

  const pendingBackend = 0;
  const totalPay = salesPay + belowPay + closeRateBonus + multiYearBonus;

  // Commissionable accounts = staged sales (serviced or below min)
  const commissionable = [...servicedStaged, ...belowStaged];

  // Stat card helper (3 cards at top)
  const statCard = (label, count, revenue, bg, fg, subFg) => el('div', {
    class: 'rounded-2xl p-5',
    style: { background: bg, color: fg, border: `1px solid ${bg}` },
  },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { opacity: '.85' } }, label),
    el('div', { class: 'text-4xl font-black mt-1 tabular-nums' }, fmt.int(count)),
    el('div', { class: 'text-xs mt-2 tabular-nums', style: { color: subFg, opacity: '.9' } }, fmt.usd(revenue) + ' revenue'),
  );

  // Pay-line row helper
  const payLine = (label, amount, opts = {}) => {
    return el('div', {
      class: 'card flex items-center justify-between px-5 py-3',
      style: opts.accent ? { borderLeft: `3px solid ${opts.accent}` } : {},
    },
      el('div', { class: 'flex items-center gap-2' },
        el('span', { class: 'font-semibold text-[14px]' }, label),
        opts.dot && el('span', { style: { color: opts.accent || 'var(--text-muted)' } }, '•'),
      ),
      el('div', { class: 'flex items-center gap-2' },
        el('span', { class: 'tabular-nums font-semibold', style: opts.textColor ? { color: opts.textColor } : {} }, amount),
        opts.suffix && el('span', { class: 'text-[10px] text-muted-' }, opts.suffix),
      ),
    );
  };

  return el('div', { class: 'flex flex-col gap-5 max-w-[1100px] mx-auto' },

    // ─── Header: name + period selector ───
    el('div', { class: 'flex items-center justify-between flex-wrap gap-3' },
      el('h1', { class: 'text-lg font-bold' }, state.profile.full_name + ' — Pay'),
      el('div', { class: 'flex items-center gap-2' },
        el('select', {
          class: 'rounded-lg border px-3 py-1.5 text-sm',
          onchange: e => {
            state.payYear = Number(e.target.value);
            state.payPeriodId = currentPayPeriodId(state.payYear);
            mountApp();
          },
        },
          ...years.map(y => el('option', { value: y, selected: y === state.payYear }, y)),
        ),
        el('select', {
          class: 'rounded-lg border px-3 py-1.5 text-sm',
          onchange: e => { state.payPeriodId = Number(e.target.value); mountApp(); },
        },
          ...periods.map(p => el('option', {
            value: p.id,
            selected: p.id === state.payPeriodId,
          }, p.label + (p.id === nowPid && state.payYear === today.getFullYear() ? ' (Current)' : ''))),
        ),
      ),
    ),

    // ─── Three stat cards ───
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-3' },
      statCard('Pending Audit',     pending.length,       pendingRev,  'var(--card)',    'var(--text)',   'var(--text-muted)'),
      statCard('Serviced (Staged)', servicedStaged.length, servicedRev, '#8DC63F',        '#1D1D1D',       'rgba(29,29,29,.75)'),
      statCard('Below Min (Staged)',belowStaged.length,    belowRev,    '#A78256',        '#FFFFFF',       'rgba(255,255,255,.85)'),
    ),

    // ─── Pay Stub header (dark) ───
    el('div', {
      class: 'rounded-2xl p-5',
      style: { background: 'var(--header-bg)', color: 'var(--header-text)' },
    },
      el('div', { class: 'text-[10px] uppercase tracking-widest', style: { opacity: '.6' } }, 'Pay Stub'),
      el('div', { class: 'text-xl font-bold mt-1' }, state.profile.full_name),
      el('div', { class: 'text-xs mt-1', style: { opacity: '.6' } }, period.isoStart + ' – ' + period.isoEnd),
    ),

    // ─── Pay line items ───
    el('div', { class: 'flex flex-col gap-2' },
      payLine('Pending Pay', fmt.usd(pendingPay), { dot: true, accent: '#8e8f80' }),
      payLine('Below Minimums', fmt.usd(belowPay), { dot: true, accent: '#A78256', textColor: belowPay > 0 ? '#A78256' : '' }),
      payLine('Sales Pay', fmt.usd(salesPay), { dot: true, accent: '#8DC63F', textColor: salesPay > 0 ? '#5F8A1F' : '' }),
      payLine('Pending Backend', fmt.usd(pendingBackend), { textColor: '#0EA5E9', suffix: '(est.)' }),
      payLine('Multi Year % Bonus', fmt.usd(multiYearBonus), { suffix: '(est.)' }),
      payLine('Close Rate', meetsCloseRate ? 'Qualified (' + fmt.pct(closeRate) + ')' : 'None (<' + fmt.pct(state.profile.close_rate_target) + ' close rate)'),
    ),

    // ─── Total Pay banner ───
    el('div', {
      class: 'rounded-2xl px-6 py-5 flex items-center justify-between',
      style: { background: 'var(--header-bg)', color: 'var(--header-text)' },
    },
      el('div', { class: 'text-[11px] uppercase tracking-widest font-bold' }, 'Total Pay'),
      el('div', { class: 'text-3xl font-black tabular-nums', style: { color: '#8DC63F' } }, fmt.usd(totalPay)),
    ),

    // ─── Commissionable Accounts ───
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'flex items-center justify-between px-5 py-4 border-b flex-wrap gap-3', style: { borderColor: 'var(--border)' } },
        el('div', {},
          el('h3', { class: 'text-base font-bold' }, 'Commissionable Accounts'),
          el('p', { class: 'text-xs text-muted-' }, 'Eligible for Upfront Pay'),
        ),
        el('div', { class: 'flex items-center gap-3 flex-wrap' },
          el('div', { class: 'text-xs text-muted-' },
            'Total: ',
            el('span', { class: 'font-bold', style: { color: 'var(--accent)' } }, fmt.usd(salesPay + belowPay)),
          ),
          isAdmin && el('button', {
            class: 'px-4 py-2 rounded-lg text-sm font-semibold transition hover:brightness-95',
            style: { background: '#1D1D1D', color: '#F3F3F3' },
            disabled: commissionable.length === 0,
            onclick: () => processPayroll(commissionable, period),
          }, 'Process Payroll →'),
          el('button', {
            class: 'px-4 py-2 rounded-lg text-sm font-medium border',
            style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
            onclick: () => downloadPayrollCsv(commissionable, period),
          }, '↓ Export CSV'),
        ),
      ),

      commissionable.length === 0
        ? el('div', { class: 'py-10 text-center text-muted- text-sm' },
            auditedUnstaged.length > 0
              ? el('span', {}, 'No accounts staged yet — use ', el('strong', {}, 'Stage for Payroll'), ' on the Sales tab')
              : 'No accounts staged yet — use ' + (isAdmin ? '"Stage" ' : '') + 'on the Sales tab',
          )
        : el('div', { class: 'scroll-x' },
            el('table', { class: 'w-full text-[12px]' },
              el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
                el('tr', {},
                  el('th', { class: 'text-left pl-5 pr-2 py-2 font-semibold' }, 'Customer'),
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Cust ID'),
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Contract'),
                  el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Revenue'),
                  el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Commission'),
                  el('th', { class: 'text-right pl-2 pr-5 py-2 font-semibold' }, 'Backend (est.)'),
                ),
              ),
              el('tbody', {},
                commissionable.map(s => {
                  const r = Number(s.revenue_amount || 0);
                  const saleRate = getCommissionRate(repId, s);
                  const commission = r * saleRate;
                  const backend = [18, 24].includes(Number(s.contract_months)) ? r * 0.02 : 0;
                  return el('tr', { class: 'border-t border-' },
                    el('td', { class: 'pl-5 pr-2 py-2 font-medium' }, s.customer_name),
                    el('td', { class: 'px-2 py-2 tabular-nums text-muted-' }, s.customer_number || '—'),
                    el('td', { class: 'px-2 py-2 text-muted- whitespace-nowrap' }, contractTypeLabelForSale(s)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.usd(r)),
                    el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold', style: { color: 'var(--accent)' } }, fmt.usd(commission)),
                    el('td', { class: 'pl-2 pr-5 py-2 text-right tabular-nums text-muted-' }, fmt.usd(backend)),
                  );
                }),
              ),
            ),
          ),
    ),

    // ─── Audited but not staged — quick-stage list ───
    auditedUnstaged.length > 0 && el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center justify-between mb-3' },
        el('h3', { class: 'text-sm font-semibold' }, `Waiting to Stage (${auditedUnstaged.length})`),
        el('button', {
          class: 'text-xs font-semibold px-3 py-1.5 rounded-lg',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => stageAllForPayroll(auditedUnstaged),
        }, 'Stage all'),
      ),
      el('div', { class: 'text-xs text-muted-' },
        auditedUnstaged.length + ' audited ' + (auditedUnstaged.length === 1 ? 'sale is' : 'sales are') + ' ready but not yet staged. Click "Stage all" or go to Sales → Stage for Payroll.',
      ),
    ),
  );
}

// Stage a single sale for payroll
async function stageSale(saleId) {
  if (DEMO) {
    for (const list of [state.mySales, state.allSales]) {
      const s = list.find(x => x.id === saleId);
      if (s) { s.staged_for_payroll = true; s.staged_at = new Date().toISOString(); }
    }
    const sale = state.allSales.find(s => s.id === saleId);
    logActivity('staged', { sale_id: saleId, customer_name: sale?.customer_name, new_status: 'staged' });
    toast('Staged for payroll', 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const { error } = await supabase.from('sales').update({
      staged_for_payroll: true,
      staged_at: new Date().toISOString(),
    }).eq('id', saleId);
    if (error) throw error;
    toast('Staged for payroll', 'success');
    await loadData();
    mountApp();
  } catch (err) { toast(err.message || 'Failed', 'error'); }
}

async function stageAllForPayroll(sales) {
  if (DEMO) {
    sales.forEach(s => {
      logActivity('staged', { sale_id: s.id, customer_name: s.customer_name, new_status: 'staged' });
      s.staged_for_payroll = true; s.staged_at = new Date().toISOString();
    });
    toast(`Staged ${sales.length} sale${sales.length === 1 ? '' : 's'}`, 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const ids = sales.map(s => s.id);
    const { error } = await supabase.from('sales').update({
      staged_for_payroll: true,
      staged_at: new Date().toISOString(),
    }).in('id', ids);
    if (error) throw error;
    toast(`Staged ${sales.length} sales`, 'success');
    await loadData();
    mountApp();
  } catch (err) { toast(err.message || 'Failed', 'error'); }
}

function processPayroll(sales, period) {
  if (!sales.length) return;
  if (!confirm(`Process payroll for ${sales.length} account${sales.length === 1 ? '' : 's'} in ${period.label}?`)) return;
  if (DEMO) {
    sales.forEach(s => {
      logActivity('payroll_processed', { sale_id: s.id, customer_name: s.customer_name, new_status: 'paid', detail: period.label });
      s.staged_for_payroll = false; s.payroll_processed_at = new Date().toISOString(); s.payroll_period = period.id;
    });
    toast(`Payroll processed for ${sales.length} accounts`, 'success');
    saveDemoData();
    mountApp();
    return;
  }
  // Real: set a flag. In a real deployment this would also generate a payroll record.
  (async () => {
    try {
      const ids = sales.map(s => s.id);
      const { error } = await supabase.from('sales').update({
        staged_for_payroll: false,
        payroll_processed_at: new Date().toISOString(),
        payroll_period_id: period.id,
      }).in('id', ids);
      if (error) throw error;
      toast(`Payroll processed for ${sales.length} accounts`, 'success');
      await loadData();
      mountApp();
    } catch (err) { toast(err.message || 'Failed', 'error'); }
  })();
}

function downloadPayrollCsv(sales, period) {
  if (!sales.length) return toast('Nothing to export', 'warn');
  const repId = state.profile.id;
  const headers = ['customer_name','customer_number','contract','revenue','rate','commission','backend_est','sold_date','status'];
  const lines = [headers.join(',')];
  for (const s of sales) {
    const r = Number(s.revenue_amount || 0);
    const saleRate = getCommissionRate(repId, s);
    const commission = r * saleRate;
    const backend = [18, 24].includes(Number(s.contract_months)) ? r * 0.02 : 0;
    lines.push([
      csvEsc(s.customer_name),
      csvEsc(s.customer_number || ''),
      csvEsc(contractTypeLabelForSale(s)),
      r.toFixed(2),
      (saleRate * 100).toFixed(2) + '%',
      commission.toFixed(2),
      backend.toFixed(2),
      s.sold_date,
      s.audit_status,
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `ridd-payroll-${state.profile.full_name.replace(/\s+/g, '-')}-${period.isoStart}.csv` });
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: COMPETITIONS
// ──────────────────────────────────────────────────────────────────────────
function viewCompetitions() {
  const active = state.competitions.filter(c => c.is_active && isCompActive(c));
  const upcoming = state.competitions.filter(c => c.is_active && new Date(c.start_date) > new Date());
  const past = state.competitions.filter(c => !c.is_active || new Date(c.end_date) < new Date());

  const container = el('div', { class: 'flex flex-col gap-6 max-w-6xl' });

  container.append(
    el('div', {},
      el('h1', { class: 'text-3xl font-bold' }, 'Competitions'),
      el('p', { class: 'text-battle-2 text-sm mt-1' }, 'Live progress on your active competitions.'),
    ),
  );

  if (active.length === 0 && upcoming.length === 0) {
    container.append(el('div', { class: 'card p-10 text-center' },
      el('div', { class: 'text-battle-2 text-sm mb-2' }, 'No competitions yet.'),
      isAdminRole(state.profile.role) && el('button', {
        class: 'mt-2 px-4 py-2 rounded-xl bg-lime text-eerie font-semibold',
        onclick: () => { state.view = 'admin'; history.replaceState(null, '', VIEW_TO_HASH['admin'] || '#admin'); mountApp(); },
      }, 'Create one \u2192'),
    ));
    return container;
  }

  active.forEach(c => container.append(competitionCard(c)));
  if (upcoming.length) {
    container.append(el('h2', { class: 'text-lg font-semibold mt-4' }, 'Upcoming'));
    upcoming.forEach(c => container.append(competitionCard(c, { compact: true })));
  }
  if (past.length) {
    container.append(el('h2', { class: 'text-lg font-semibold mt-4' }, 'Past'));
    past.slice(0, 5).forEach(c => container.append(competitionCard(c, { compact: true })));
  }
  return container;
}

function competitionCard(comp, { compact = false } = {}) {
  const rules = state.compRules.filter(r => r.competition_id === comp.id);
  const myProgress = state.compProgress.filter(p => p.competition_id === comp.id && p.rep_id === state.profile.id);
  const progressByRuleId = Object.fromEntries(myProgress.map(p => [p.rule_id, p]));

  // Bingo grid vs list
  const isBingo = comp.type === 'bingo';
  const gridRules = isBingo
    ? rules.filter(r => r.bingo_row != null && r.bingo_col != null).sort((a, b) => a.bingo_row - b.bingo_row || a.bingo_col - b.bingo_col)
    : rules;

  const cols = isBingo ? Math.max(...rules.map(r => r.bingo_col || 0), 0) + 1 : 0;

  const card = el('div', { class: 'card p-5 sm:p-6' },
    // Header
    el('div', { class: 'flex items-start justify-between gap-4 mb-4' },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest text-battleship' },
          comp.category.replace('_', ' ') + ' · ' + comp.type + ' · ' + fmt.dateShort(comp.start_date) + ' → ' + fmt.dateShort(comp.end_date)),
        el('h2', { class: 'text-2xl font-bold mt-1' }, comp.name),
        comp.description && el('p', { class: 'text-sm text-battle-2 mt-1 max-w-2xl' }, comp.description),
      ),
      el('div', { class: 'text-right shrink-0' },
        el('div', { class: 'text-[10px] uppercase tracking-widest text-battleship' }, 'Prize'),
        el('div', { class: 'text-lg font-bold text-lime' }, comp.prize_text || '—'),
      ),
    ),

    compact ? null :
    // Bingo card grid
    isBingo && gridRules.length > 0
      ? el('div', {
          class: 'grid gap-2',
          style: { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` },
        },
          gridRules.map(rule => {
            const p = progressByRuleId[rule.id];
            const met = p?.met || false;
            const cv = p ? Number(p.current_value) : 0;
            return el('div', {
              class: 'bingo-square',
              'data-met': met,
              title: `${rule.label} — current: ${cv}/${rule.threshold}`,
            },
              el('div', { class: 'font-semibold' }, rule.label),
              el('div', { class: 'text-[10px] text-battleship mt-1 tabular-nums' }, `${cv} / ${rule.threshold}`),
              el('div', { class: 'check mt-1' }, '✓'),
            );
          })
        )
      : !isBingo && rules.length > 0
        ? el('div', { class: 'flex flex-col gap-2' },
            rules.map(rule => {
              const p = progressByRuleId[rule.id];
              const met = p?.met || false;
              const cv = p ? Number(p.current_value) : 0;
              return el('div', {
                class: 'flex items-center justify-between p-3 rounded-lg border border-eerie3 bg-eerie',
                style: met ? { borderColor: '#8DC63F', background: 'rgba(141,198,63,.08)' } : {},
              },
                el('div', {},
                  el('div', { class: 'text-sm font-medium' }, rule.label),
                  el('div', { class: 'text-xs text-battle-2' }, `${metricLabel(rule.metric)} · ${rule.window}`),
                ),
                el('div', { class: 'text-right' },
                  el('div', { class: 'text-sm font-semibold tabular-nums' + (met ? ' text-lime' : '') }, `${cv} / ${rule.threshold}`),
                  met ? el('div', { class: 'text-[10px] text-lime uppercase tracking-widest' }, 'Qualified') : null,
                ),
              );
            }))
        : el('div', { class: 'text-sm text-battle-2 italic' }, 'No rules defined for this competition yet.'),

    // Compact stats
    compact && el('div', { class: 'text-xs text-battle-2 mt-1' }, comp.prize_text || ''),
  );

  return card;
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: HISTORY
// ──────────────────────────────────────────────────────────────────────────
// ──────────────────────────────────────────────────────────────────────────
// VIEW: HALL OF FAME — personal records per rep
// ──────────────────────────────────────────────────────────────────────────
function viewHallOfFame() {
  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile];
  const byRep = groupBy(state.allSales, s => s.rep_id);

  // Compute records for every rep + overall company records
  const repCards = profiles.map(p => {
    const records = computeRepRecords(p.id, byRep[p.id] || []);
    return { profile: p, ...records };
  });

  // All-time company best day/week/month
  const companyBest = {
    bestDay:   repCards.reduce((a, r) => r.bestDay.revenue   > (a?.revenue || 0) ? { rep: r.profile, ...r.bestDay }   : a, null),
    bestWeek:  repCards.reduce((a, r) => r.bestWeek.revenue  > (a?.revenue || 0) ? { rep: r.profile, ...r.bestWeek }  : a, null),
    bestMonth: repCards.reduce((a, r) => r.bestMonth.revenue > (a?.revenue || 0) ? { rep: r.profile, ...r.bestMonth } : a, null),
  };

  return el('div', { class: 'flex flex-col gap-6 max-w-6xl mx-auto' },
    el('div', {},
      el('h1', { class: 'text-3xl font-bold flex items-center gap-3' },
        el('span', { class: 'text-4xl' }, '🏆'),
        'Hall of Fame',
      ),
      el('p', { class: 'text-sm text-muted- mt-1' }, 'Personal bests. Beat them, break them, earn a badge.'),
    ),

    // Company records podium
    companyBest.bestDay && el('div', {},
      el('h2', { class: 'text-lg font-semibold mb-3' }, 'Company Records'),
      el('div', { class: 'grid grid-cols-1 md:grid-cols-3 gap-3' },
        companyRecordCard('Best Day',   companyBest.bestDay,   'day'),
        companyRecordCard('Best Week',  companyBest.bestWeek,  'week'),
        companyRecordCard('Best Month', companyBest.bestMonth, 'month'),
      ),
    ),

    // Per-rep records
    el('div', {},
      el('h2', { class: 'text-lg font-semibold mb-3' }, 'Personal Bests'),
      el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-3' },
        repCards
          .filter(r => r.bestDay.revenue > 0)
          .sort((a, b) => b.bestDay.revenue - a.bestDay.revenue)
          .map(r => el('div', { class: 'card p-5' },
            el('div', { class: 'flex items-center gap-3 mb-4' },
              avatarNode(r.profile.avatar_url, r.profile.initials, 'w-12 h-12 text-xs'),
              el('div', { class: 'flex-1' },
                el('div', { class: 'text-base font-bold' }, r.profile.full_name),
                el('div', { class: 'text-[10px] uppercase tracking-widest text-muted-' }, 'Personal bests'),
              ),
            ),
            el('div', { class: 'grid grid-cols-3 gap-3 text-center' },
              recordStat('Best Day',   r.bestDay.revenue,   r.bestDay.count,   r.bestDay.date),
              recordStat('Best Week',  r.bestWeek.revenue,  r.bestWeek.count,  r.bestWeek.weekStart),
              recordStat('Best Month', r.bestMonth.revenue, r.bestMonth.count, r.bestMonth.month),
            ),
          )),
      ),
      repCards.every(r => r.bestDay.revenue === 0) && el('div', { class: 'card p-8 text-center text-muted- text-sm' }, 'No records yet — start logging sales and the Hall of Fame will fill in.'),
    ),
  );
}

function companyRecordCard(title, rec, kind) {
  if (!rec || rec.revenue === 0) return el('div', { class: 'card p-5 text-center text-muted- text-sm' }, 'No record yet');
  const subtitle = kind === 'day' ? rec.date
    : kind === 'week' ? `Week of ${rec.weekStart}`
    : rec.month;
  return el('div', { class: 'card p-5' },
    el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold' }, title),
    el('div', { class: 'flex items-center gap-3 mt-3' },
      avatarNode(rec.rep?.avatar_url, rec.rep?.initials, 'w-10 h-10 text-xs'),
      el('div', { class: 'flex-1' },
        el('div', { class: 'text-sm font-semibold' }, rec.rep?.full_name || '—'),
        el('div', { class: 'text-[10px] text-muted-' }, subtitle),
      ),
    ),
    el('div', { class: 'mt-3 pt-3 border-t border-' },
      el('div', { class: 'text-2xl font-black tabular-nums', style: { color: 'var(--accent)' } }, fmt.usd0(rec.revenue)),
      el('div', { class: 'text-xs text-muted-' }, fmt.int(rec.count) + ' sales'),
    ),
  );
}

function recordStat(label, revenue, count, date) {
  return el('div', { class: 'card-2 rounded-lg p-3 border border-' },
    el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-semibold' }, label),
    el('div', { class: 'text-base font-bold tabular-nums mt-1' }, revenue > 0 ? fmt.usd0(revenue) : '—'),
    el('div', { class: 'text-[10px] text-muted-' }, count > 0 ? fmt.int(count) + ' sales' : '\u00A0'),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: INDICATORS — D2D performance dashboard powered by CSV upload
// ──────────────────────────────────────────────────────────────────────────
const BRANCH_COLORS = {
  'ATLANTA':        '#A01C22',
  'CHARLESTON':     '#416AA7',
  'DESTIN':         '#AD3CC4',
  'MYRTLE BEACH':   '#49AEAC',
  'RALEIGH':        '#A4C8DF',
  'SALT LAKE':      '#2A7727',
  'VIRGINIA BEACH': '#65EB4D',
};
const RIDD_COLOR = '#8DC63F';
const INDICATOR_METRICS = [
  { key: 'sold_accounts',  label: 'Sold Accounts',    fmt: v => fmt.int(v) },
  { key: 'revenue',        label: 'D2D Revenue',      fmt: v => fmt.usd0(v) },
  { key: 'avg_initial',    label: 'Avg Pest Initial',   fmt: v => fmt.usd(v) },
  { key: 'acv',            label: 'ACV',              fmt: v => fmt.usd(v) },
  { key: 'pra',            label: 'PRA',              fmt: v => fmt.usd(v) },
  { key: 'multi_year_pct', label: 'Multi Year %',     fmt: v => (v * 100).toFixed(1) + '%' },
  { key: 'auto_pay_pct',   label: 'Auto Pay %',       fmt: v => (v * 100).toFixed(1) + '%' },
  { key: 'reps',           label: 'Reps W/ A Sale',   fmt: v => fmt.int(v) },
];

function viewIndicators() {
  if (!state.indicatorsData) state.indicatorsData = null;
  if (!state.indicatorsView) state.indicatorsView = 'weekly';
  if (state.indicatorsWeek == null) state.indicatorsWeek = -1; // -1 = latest

  // If no data uploaded yet, show upload UI
  if (!state.indicatorsData || !state.indicatorsData.length) {
    return el('div', { class: 'flex flex-col gap-5 max-w-6xl mx-auto' },
      el('h1', { class: 'text-2xl font-bold' }, 'D2D Indicators'),
      el('div', { class: 'card p-10 text-center' },
        el('div', { class: 'text-4xl mb-3' }, '📊'),
        el('h2', { class: 'text-lg font-bold mb-2' }, 'Upload CSV to get started'),
        el('p', { class: 'text-sm text-muted- mb-4 max-w-md mx-auto' },
          'Upload the D2D Indicators CSV with columns: Week, Date, Branch, Sold Accounts, Weekly Sold Revenue, Avg. Initial, Auto Pay %, Appruv %, Multi-Years, Reps W/ a Sale'),
        csvUploadButton(),
      ),
    );
  }

  const data = state.indicatorsData;
  const weeks = [...new Set(data.map(r => r.week))].sort((a, b) => a - b);
  const branches = [...new Set(data.map(r => r.branch))].sort();
  const currentWeek = state.indicatorsWeek === -1 ? weeks[weeks.length - 1] : state.indicatorsWeek;
  const isCumulative = state.indicatorsView === 'cumulative';

  // Aggregate data
  const branchData = {};
  branches.forEach(b => {
    const rows = isCumulative
      ? data.filter(r => r.branch === b)
      : data.filter(r => r.branch === b && r.week === currentWeek);
    if (!rows.length) { branchData[b] = null; return; }
    const sold = rows.reduce((a, r) => a + r.sold_accounts, 0);
    const rev  = rows.reduce((a, r) => a + r.revenue, 0);
    const multi= rows.reduce((a, r) => a + r.multi_years, 0);       // count of 18+24 month contracts
    const twelve = rows.reduce((a, r) => a + r.twelve_month, 0);    // count of 12 month contracts
    const reps = isCumulative ? Math.max(...rows.map(r => r.reps)) : rows[0]?.reps || 0;
    const avgInit = rows.reduce((a, r) => a + r.avg_initial * r.sold_accounts, 0) / (sold || 1);
    const autoPay = rows.reduce((a, r) => a + r.auto_pay_pct * r.sold_accounts, 0) / (sold || 1);
    // Multi Year % = count(12-month) / count(12+18+24 month contracts)
    const contractTotal = twelve + multi;
    branchData[b] = {
      sold_accounts: sold,
      revenue: rev,
      avg_initial: avgInit,
      acv: sold > 0 ? rev / sold : 0,
      pra: reps > 0 ? rev / reps : 0,
      multi_year_pct: contractTotal > 0 ? twelve / contractTotal : 0,
      auto_pay_pct: autoPay,
      reps: reps,
    };
  });

  // Compute RIDD totals
  const riddTotal = {};
  const activeBranches = branches.filter(b => branchData[b]);
  INDICATOR_METRICS.forEach(m => {
    if (m.key === 'avg_initial' || m.key === 'auto_pay_pct' || m.key === 'appruv_pct' || m.key === 'multi_year_pct') {
      const totalSold = activeBranches.reduce((a, b) => a + (branchData[b]?.sold_accounts || 0), 0);
      riddTotal[m.key] = totalSold > 0
        ? activeBranches.reduce((a, b) => a + (branchData[b]?.[m.key] || 0) * (branchData[b]?.sold_accounts || 0), 0) / totalSold
        : 0;
    } else if (m.key === 'acv') {
      const totalSold = activeBranches.reduce((a, b) => a + (branchData[b]?.sold_accounts || 0), 0);
      const totalRev = activeBranches.reduce((a, b) => a + (branchData[b]?.revenue || 0), 0);
      riddTotal[m.key] = totalSold > 0 ? totalRev / totalSold : 0;
    } else if (m.key === 'pra') {
      const totalRev = activeBranches.reduce((a, b) => a + (branchData[b]?.revenue || 0), 0);
      const totalReps = activeBranches.reduce((a, b) => a + (branchData[b]?.reps || 0), 0);
      riddTotal[m.key] = totalReps > 0 ? totalRev / totalReps : 0;
    } else {
      riddTotal[m.key] = activeBranches.reduce((a, b) => a + (branchData[b]?.[m.key] || 0), 0);
    }
  });

  // Compute rankings (higher = better for all metrics)
  const rankings = {};
  INDICATOR_METRICS.forEach(m => {
    const sorted = activeBranches
      .filter(b => branchData[b])
      .map(b => ({ branch: b, val: branchData[b][m.key] || 0 }))
      .sort((a, b) => b.val - a.val);
    rankings[m.key] = sorted.map((s, i) => ({ ...s, rank: i + 1, points: activeBranches.length - i }));
  });

  // Total points per branch
  const totalPoints = {};
  activeBranches.forEach(b => {
    totalPoints[b] = INDICATOR_METRICS.reduce((sum, m) => {
      const entry = rankings[m.key]?.find(r => r.branch === b);
      return sum + (entry?.points || 0);
    }, 0);
  });
  const powerRanking = activeBranches.slice().sort((a, b) => (totalPoints[b] || 0) - (totalPoints[a] || 0));

  // Date label for current week
  const weekRow = data.find(r => r.week === currentWeek);
  const dateLabel = weekRow?.date || '';

  return el('div', { class: 'flex flex-col gap-5 max-w-[1400px] mx-auto' },

    // ── Header row ──
    el('div', { class: 'flex items-center justify-between flex-wrap gap-3' },
      el('div', {},
        el('h1', { class: 'text-lg font-bold' }, isCumulative ? 'D2D INDICATORS — Season to Date' : 'D2D INDICATORS'),
        !isCumulative && dateLabel && el('div', { class: 'text-xs text-muted-' }, dateLabel),
      ),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        // Weekly / Cumulative toggle
        el('div', { class: 'pill-tabs' },
          el('button', { 'data-active': state.indicatorsView === 'weekly', onclick: () => { state.indicatorsView = 'weekly'; mountApp(); } }, 'Weekly'),
          el('button', { 'data-active': state.indicatorsView === 'cumulative', onclick: () => { state.indicatorsView = 'cumulative'; mountApp(); } }, 'Cumulative'),
        ),
        // Week selector (weekly view only)
        !isCumulative && el('select', {
          class: 'rounded-xl px-3 py-2 text-xs font-medium cursor-pointer',
          onchange: e => { state.indicatorsWeek = Number(e.target.value); mountApp(); },
        },
          ...weeks.map(w => el('option', {
            value: w,
            selected: w === currentWeek,
          }, 'Week ' + w)),
        ),
        // Re-upload
        csvUploadButton('sm'),
      ),
    ),

    // ── Main metrics table (click metric name to sort branches) ──
    (() => {
      // Sort state: which metric is sorting the columns, and direction
      if (!state._indicatorSort) state._indicatorSort = { key: null, asc: false };
      const sort = state._indicatorSort;

      // Determine column order (branches sorted by the selected metric)
      let sortedBranches = [...branches];
      if (sort.key) {
        sortedBranches.sort((a, b) => {
          const va = branchData[a]?.[sort.key] || 0;
          const vb = branchData[b]?.[sort.key] || 0;
          return sort.asc ? va - vb : vb - va;
        });
      }

      return el('div', { class: 'card overflow-hidden' },
        el('div', { class: 'scroll-x' },
          el('table', { class: 'w-full text-[12px]' },
            el('thead', {},
              el('tr', {},
                el('th', { class: 'text-left px-3 py-2 text-[10px] uppercase tracking-wider text-muted- font-semibold sticky left-0', style: { background: 'var(--card)', zIndex: 2 } }, 'Indicators'),
                ...sortedBranches.map((b, i) => el('th', {
                  class: 'text-center px-3 py-2 text-[10px] uppercase tracking-wider font-bold text-white',
                  style: { background: BRANCH_COLORS[b] || '#666', minWidth: '100px' },
                },
                  sort.key ? (i + 1) + '. ' : '',
                  b.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' '),
                )),
                el('th', { class: 'text-center px-3 py-2 text-[10px] uppercase tracking-wider font-bold', style: { background: '#1D1D1D', color: RIDD_COLOR, minWidth: '100px' } }, 'RIDD'),
              ),
            ),
            el('tbody', {},
              ...INDICATOR_METRICS.map(m => {
                const isSorting = sort.key === m.key;
                return el('tr', { class: 'border-t border-' + (isSorting ? ' font-bold' : '') },
                  el('td', {
                    class: 'px-3 py-2 font-semibold text-xs sticky left-0 cursor-pointer select-none hover:underline',
                    style: { background: 'var(--card)', zIndex: 1, color: isSorting ? 'var(--accent)' : '' },
                    onclick: () => {
                      if (sort.key === m.key) { sort.asc = !sort.asc; }
                      else { sort.key = m.key; sort.asc = false; }
                      mountApp();
                    },
                  },
                    m.label,
                    isSorting ? (sort.asc ? ' ↑' : ' ↓') : '',
                  ),
                  ...sortedBranches.map(b => el('td', { class: 'px-3 py-2 text-center tabular-nums' },
                    branchData[b] ? m.fmt(branchData[b][m.key]) : '—',
                  )),
                  el('td', { class: 'px-3 py-2 text-center tabular-nums font-bold' }, m.fmt(riddTotal[m.key])),
                );
              }),
              // Total Points row
              el('tr', { class: 'border-t-2', style: { borderColor: 'var(--accent)' } },
                el('td', {
                  class: 'px-3 py-2 font-bold text-xs sticky left-0 cursor-pointer select-none hover:underline',
                  style: { background: 'var(--card)', zIndex: 1, color: sort.key === '_points' ? 'var(--accent)' : '' },
                  onclick: () => {
                    if (sort.key === '_points') { sort.asc = !sort.asc; }
                    else { sort.key = '_points'; sort.asc = false; }
                    mountApp();
                  },
                },
                  'Total Points',
                  sort.key === '_points' ? (sort.asc ? ' ↑' : ' ↓') : '',
                ),
                ...(() => {
                  // Re-sort for points if that's the active sort
                  let ptsBranches = [...sortedBranches];
                  if (sort.key === '_points') {
                    ptsBranches = [...branches].sort((a, b) => sort.asc
                      ? (totalPoints[a] || 0) - (totalPoints[b] || 0)
                      : (totalPoints[b] || 0) - (totalPoints[a] || 0));
                  }
                  return ptsBranches.map(b => el('td', { class: 'px-3 py-2 text-center tabular-nums font-black text-base' }, fmt.int(totalPoints[b] || 0)));
                })(),
                el('td', {}),
              ),
            ),
          ),
        ),
      );
    })(),

    // ── Rankings grid ──
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
      ...['revenue', 'avg_initial', 'acv', 'pra', 'multi_year_pct', 'auto_pay_pct'].map(key => {
        const m = INDICATOR_METRICS.find(x => x.key === key);
        const ranked = rankings[key] || [];
        return el('div', { class: 'card p-3' },
          el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, m?.label || key),
          el('div', { class: 'flex flex-col gap-0.5' },
            ...ranked.map((r, i) => el('div', { class: 'flex items-center justify-between text-xs py-0.5' },
              el('div', { class: 'flex items-center gap-1.5' },
                el('span', { class: 'font-bold tabular-nums w-4', style: { color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' } }, r.rank),
                el('span', { style: { color: BRANCH_COLORS[r.branch] || 'var(--text)' } },
                  r.branch.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ')),
              ),
            )),
          ),
        );
      }),
      // Power Ranking
      el('div', { class: 'card p-3', style: { borderColor: 'var(--accent)', borderWidth: '2px' } },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-2', style: { color: 'var(--accent)' } }, 'Power Ranking'),
        el('div', { class: 'flex flex-col gap-0.5' },
          ...powerRanking.map((b, i) => el('div', { class: 'flex items-center justify-between text-xs py-0.5' },
            el('div', { class: 'flex items-center gap-1.5' },
              el('span', { class: 'font-bold tabular-nums w-4', style: { color: i === 0 ? 'var(--accent)' : 'var(--text-muted)' } }, i + 1),
              el('span', { class: 'font-semibold', style: { color: BRANCH_COLORS[b] || 'var(--text)' } },
                b.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' ')),
            ),
            el('span', { class: 'text-[10px] tabular-nums text-muted-' }, totalPoints[b] + 'pts'),
          )),
        ),
      ),
    ),

    // ── Charts ──
    el('div', { class: 'grid grid-cols-1 md:grid-cols-2 gap-4' },
      indicatorChart('Weekly PRA', data, branches, 'pra', weeks),
      indicatorChart('Weekly Revenue', data, branches, 'revenue', weeks),
    ),
    el('div', {},
      indicatorChart('Branch Power Ranking', data, branches, '_power_ranking', weeks, true),
    ),

    // ════════════════════════════════════════════════════════════════
    // REP-LEVEL ANALYTICS (computed from raw sales if available)
    // ════════════════════════════════════════════════════════════════
    ...indicatorRepSections(data, isCumulative, currentWeek),
  );
}

// ── Rep-level sections for Indicators tab ──
function indicatorRepSections(data, isCumulative, currentWeek) {
  // We need the raw sales data — stored alongside aggregated rows
  const rawSales = state._indicatorRawSales;
  if (!rawSales || !rawSales.length) return [el('div', {})]; // no raw data available

  const sections = [];

  // ── Compute rep stats ──
  const parseNum = (s) => parseFloat(String(s || '').replace(/[$,%]/g,'').replace(/,/g,'').trim()) || 0;
  const repMap = {};
  rawSales.forEach(s => {
    const rep = s.rep || 'Unknown';
    if (!repMap[rep]) repMap[rep] = { name: rep, office: s.office, sales: [], cancels: 0, revenue: 0, multi: 0, twelve: 0, autoPay: 0, aged: 0 };
    const r = repMap[rep];
    r.sales.push(s);
    r.revenue += s.contractValue;
    if (s.contract > 12) r.multi++;
    if (s.contract === 12) r.twelve++;
    if (s.autoPay && s.autoPay !== 'No') r.autoPay++;
    if ((s.cancelDate || s.active === 'No')) r.cancels++;
    if (s.age > 0) r.aged++;
  });
  const reps = Object.values(repMap).sort((a, b) => b.sales.length - a.sales.length);

  // ── 1. REP LEADERBOARD ──
  if (!state._indicatorSelectedRep) state._indicatorSelectedRep = null;
  sections.push(
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-5 py-3 border-b flex items-center justify-between', style: { borderColor: 'var(--border)' } },
        el('h3', { class: 'text-base font-bold' }, 'Rep Leaderboard'),
        el('span', { class: 'text-xs text-muted-' }, reps.length + ' reps'),
      ),
      el('div', { class: 'scroll-x' },
        el('table', { class: 'w-full text-[12px]' },
          el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted-' },
            el('tr', {},
              el('th', { class: 'text-left pl-5 pr-2 py-2 font-semibold w-8' }, '#'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Rep'),
              el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Office'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Sales'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Revenue'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'ACV'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'MY %'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Auto Pay'),
              el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Cancels'),
              el('th', { class: 'text-right pl-2 pr-5 py-2 font-semibold' }, 'Cancel %'),
            ),
          ),
          el('tbody', {},
            ...reps.slice(0, 30).map((r, i) => {
              const count = r.sales.length;
              const acv = count > 0 ? r.revenue / count : 0;
              const ctTotal = r.twelve + r.multi;
              const myPct = ctTotal > 0 ? r.twelve / ctTotal : 0;
              const autoPayPct = count > 0 ? r.autoPay / count : 0;
              const cancelPct = count > 0 ? r.cancels / count : 0;
              const isSelected = state._indicatorSelectedRep === r.name;
              return el('tr', {
                class: 'border-t border- cursor-pointer transition',
                style: isSelected ? { background: 'rgba(141,198,63,.1)' } : {},
                onclick: () => { state._indicatorSelectedRep = isSelected ? null : r.name; mountApp(); },
              },
                el('td', { class: 'pl-5 pr-2 py-2 font-bold tabular-nums', style: i === 0 ? { color: 'var(--accent)' } : {} }, i + 1),
                el('td', { class: 'px-2 py-2 font-semibold' }, r.name),
                el('td', { class: 'px-2 py-2 text-muted-' }, (r.office || '').split(' ').map(w => w[0]?.toUpperCase() + w.slice(1).toLowerCase()).join(' ')),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.int(count)),
                el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold' }, fmt.usd0(r.revenue)),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, fmt.usd(acv)),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, (myPct * 100).toFixed(1) + '%'),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, (autoPayPct * 100).toFixed(1) + '%'),
                el('td', { class: 'px-2 py-2 text-right tabular-nums' }, r.cancels > 0 ? fmt.int(r.cancels) : '—'),
                el('td', { class: 'pl-2 pr-5 py-2 text-right tabular-nums', style: cancelPct > 0.1 ? { color: '#DC2626', fontWeight: '600' } : {} },
                  cancelPct > 0 ? (cancelPct * 100).toFixed(1) + '%' : '—'),
              );
            }),
          ),
        ),
      ),
    ),
  );

  // ── 2. SELECTED REP DETAIL ──
  if (state._indicatorSelectedRep) {
    const r = repMap[state._indicatorSelectedRep];
    if (r) {
      const count = r.sales.length;
      const acv = count > 0 ? r.revenue / count : 0;
      const ctTotal = r.twelve + r.multi;
      const myPct = ctTotal > 0 ? r.twelve / ctTotal : 0;
      const autoPayPct = count > 0 ? r.autoPay / count : 0;
      // Top subscriptions
      const subCounts = {};
      r.sales.forEach(s => { subCounts[s.subscription] = (subCounts[s.subscription] || 0) + 1; });
      const topSubs = Object.entries(subCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      // Top sources
      const srcCounts = {};
      r.sales.forEach(s => { srcCounts[s.source] = (srcCounts[s.source] || 0) + 1; });
      const topSrcs = Object.entries(srcCounts).sort((a, b) => b[1] - a[1]).slice(0, 5);
      // Cancels
      const repCancels = r.sales.filter(s => s.cancelDate || s.active === 'No');

      sections.push(
        el('div', { class: 'card p-5' },
          el('div', { class: 'flex items-center justify-between mb-4' },
            el('h3', { class: 'text-lg font-bold' }, '📋 ' + r.name),
            el('button', { class: 'text-xs text-muted- hover:text-default', onclick: () => { state._indicatorSelectedRep = null; mountApp(); } }, '✕ Close'),
          ),
          // Stat grid
          el('div', { class: 'grid grid-cols-3 sm:grid-cols-6 gap-3 mb-5' },
            ...([
              ['Sales', fmt.int(count)],
              ['Revenue', fmt.usd0(r.revenue)],
              ['ACV', fmt.usd(acv)],
              ['MY %', (myPct * 100).toFixed(1) + '%'],
              ['Auto Pay', (autoPayPct * 100).toFixed(1) + '%'],
              ['Cancels', fmt.int(r.cancels)],
            ].map(([label, value]) => el('div', { class: 'card-2 rounded-lg border border- p-3 text-center' },
              el('div', { class: 'text-[9px] uppercase tracking-widest text-muted- font-semibold' }, label),
              el('div', { class: 'text-lg font-bold tabular-nums mt-1' }, value),
            ))),
          ),
          // Two columns: top subscriptions + top sources
          el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
            el('div', {},
              el('h4', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-2' }, 'Top Subscriptions'),
              el('div', { class: 'flex flex-col gap-1' },
                ...topSubs.map(([name, cnt]) => el('div', { class: 'flex items-center justify-between text-xs py-1 border-b border-' },
                  el('span', {}, name),
                  el('span', { class: 'font-semibold tabular-nums' }, cnt),
                )),
              ),
            ),
            el('div', {},
              el('h4', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-2' }, 'Top Sources'),
              el('div', { class: 'flex flex-col gap-1' },
                ...topSrcs.map(([name, cnt]) => el('div', { class: 'flex items-center justify-between text-xs py-1 border-b border-' },
                  el('span', {}, name || 'Unknown'),
                  el('span', { class: 'font-semibold tabular-nums' }, cnt),
                )),
              ),
            ),
          ),
          // Cancel list for this rep
          repCancels.length > 0 && el('div', { class: 'mt-4' },
            el('h4', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-2' }, 'Cancelled Accounts (' + repCancels.length + ')'),
            el('div', { class: 'flex flex-col gap-1' },
              ...repCancels.map(s => el('div', { class: 'flex items-center justify-between text-xs py-1 border-b border-' },
                el('span', {}, s.customer || '—'),
                el('div', { class: 'flex items-center gap-3' },
                  el('span', { class: 'text-muted-' }, s.subscription || ''),
                  el('span', { class: 'text-muted-' }, s.cancelReason || 'No reason'),
                ),
              )),
            ),
          ),
        ),
      );
    }
  }

  // ── 3. CANCEL ANALYSIS ──
  const allCancels = rawSales.filter(s => s.cancelDate || s.active === 'No');
  if (allCancels.length > 0 || rawSales.length > 0) {
    // By reason
    const reasonCounts = {};
    allCancels.forEach(s => {
      const reason = (s.cancelReason || 'Unspecified').trim();
      reasonCounts[reason] = (reasonCounts[reason] || 0) + 1;
    });
    const topReasons = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]);

    // By package (cancel rate per subscription)
    const subStats = {};
    rawSales.forEach(s => {
      const sub = s.subscription || 'Unknown';
      if (!subStats[sub]) subStats[sub] = { total: 0, cancels: 0 };
      subStats[sub].total++;
      if (s.cancelDate || s.active === 'No') subStats[sub].cancels++;
    });
    const subCancelRates = Object.entries(subStats)
      .filter(([_, v]) => v.total >= 5) // min 5 sales to show
      .map(([name, v]) => ({ name, ...v, rate: v.cancels / v.total }))
      .sort((a, b) => b.rate - a.rate);

    sections.push(
      el('div', { class: 'card p-5' },
        el('h3', { class: 'text-base font-bold mb-4' }, '🚫 Cancel Analysis'),
        el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-5' },
          // By reason
          el('div', {},
            el('h4', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-2' }, 'By Reason (' + allCancels.length + ' total)'),
            el('div', { class: 'flex flex-col gap-1' },
              ...topReasons.map(([reason, cnt]) => el('div', { class: 'flex items-center justify-between text-xs py-1.5 border-b border-' },
                el('span', {}, reason),
                el('span', { class: 'font-semibold tabular-nums' }, cnt),
              )),
            ),
          ),
          // By package (highest cancel rate)
          el('div', {},
            el('h4', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-2' }, 'By Package (highest cancel rate, min 5 sales)'),
            el('div', { class: 'flex flex-col gap-1' },
              ...subCancelRates.slice(0, 10).map(s => el('div', { class: 'flex items-center justify-between text-xs py-1.5 border-b border-' },
                el('span', { class: 'truncate max-w-[200px]', title: s.name }, s.name),
                el('div', { class: 'flex items-center gap-3 shrink-0' },
                  el('span', { class: 'text-muted-' }, s.cancels + '/' + s.total),
                  el('span', { class: 'font-semibold tabular-nums', style: s.rate > 0.1 ? { color: '#DC2626' } : {} }, (s.rate * 100).toFixed(1) + '%'),
                ),
              )),
            ),
          ),
        ),

        // ── Attrition by Office ──
        el('div', { class: 'mt-5' },
          el('h4', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-3' }, 'Attrition by Office'),
          el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
            ...(() => {
              const officeCancel = {};
              rawSales.forEach(s => {
                const o = s.office || 'Unknown';
                if (!officeCancel[o]) officeCancel[o] = { total: 0, cancels: 0 };
                officeCancel[o].total++;
                if (s.cancelDate || s.active === 'No') officeCancel[o].cancels++;
              });
              return Object.entries(officeCancel)
                .map(([name, v]) => ({ name, ...v, rate: v.total > 0 ? v.cancels / v.total : 0 }))
                .sort((a, b) => b.rate - a.rate)
                .map(o => el('div', { class: 'card-2 rounded-xl border border- p-4 text-center' },
                  el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold mb-1', style: { color: BRANCH_COLORS[o.name.toUpperCase()] || 'var(--text-muted)' } }, o.name),
                  el('div', { class: 'text-2xl font-black tabular-nums', style: o.rate > 0.05 ? { color: '#DC2626' } : {} }, (o.rate * 100).toFixed(1) + '%'),
                  el('div', { class: 'text-[10px] text-muted- mt-1 tabular-nums' }, o.cancels + ' cancels / ' + o.total + ' sales'),
                ));
            })(),
          ),
        ),

        // ── 3-Day ROR Breakdown ──
        (() => {
          const rors = allCancels.filter(s => (s.cancelReason || '').includes('3 Day ROR'));
          if (!rors.length) return el('div', {});

          // By office
          const rorByOffice = {};
          rors.forEach(s => { rorByOffice[s.office] = (rorByOffice[s.office] || 0) + 1; });
          const rorOffices = Object.entries(rorByOffice).sort((a, b) => b[1] - a[1]);

          // By rep
          const rorByRep = {};
          rors.forEach(s => { rorByRep[s.rep || 'Unknown'] = (rorByRep[s.rep || 'Unknown'] || 0) + 1; });
          const rorReps = Object.entries(rorByRep).sort((a, b) => b[1] - a[1]);

          return el('div', { class: 'mt-5' },
            el('h4', { class: 'text-xs font-bold uppercase tracking-widest text-muted- mb-1' }, '3-Day Right of Rescission Breakdown (' + rors.length + ')'),
            el('p', { class: 'text-[10px] text-muted- mb-3' }, rors.length + ' of ' + allCancels.length + ' cancels (' + (allCancels.length > 0 ? (rors.length / allCancels.length * 100).toFixed(0) : 0) + '%) are buyer\'s remorse within the 3-day window.'),
            el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-5' },
              // By office
              el('div', {},
                el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, 'By Office'),
                el('div', { class: 'flex flex-col gap-1' },
                  ...rorOffices.map(([office, cnt]) => {
                    const totalForOffice = rawSales.filter(s => s.office === office).length;
                    return el('div', { class: 'flex items-center justify-between text-xs py-1.5 border-b border-' },
                      el('span', { style: { color: BRANCH_COLORS[office.toUpperCase()] || 'var(--text)' } }, office),
                      el('div', { class: 'flex items-center gap-3' },
                        el('span', { class: 'text-muted-' }, cnt + '/' + totalForOffice),
                        el('span', { class: 'font-semibold tabular-nums' }, (cnt / totalForOffice * 100).toFixed(1) + '%'),
                      ),
                    );
                  }),
                ),
              ),
              // By rep (top 10)
              el('div', {},
                el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, 'By Rep (highest ROR count)'),
                el('div', { class: 'flex flex-col gap-1' },
                  ...rorReps.slice(0, 10).map(([rep, cnt]) => {
                    const totalForRep = rawSales.filter(s => s.rep === rep).length;
                    return el('div', { class: 'flex items-center justify-between text-xs py-1.5 border-b border-' },
                      el('span', {}, rep),
                      el('div', { class: 'flex items-center gap-3' },
                        el('span', { class: 'text-muted-' }, cnt + '/' + totalForRep),
                        el('span', { class: 'font-semibold tabular-nums', style: cnt / totalForRep > 0.1 ? { color: '#DC2626' } : {} }, (cnt / totalForRep * 100).toFixed(1) + '%'),
                      ),
                    );
                  }),
                ),
              ),
            ),
          );
        })(),
      ),
    );
  }

  // ── 4. AGING DASHBOARD ──
  const agedAccounts = rawSales.filter(s => s.age > 0);
  if (agedAccounts.length > 0) {
    const byOffice = {};
    agedAccounts.forEach(s => { byOffice[s.office] = (byOffice[s.office] || 0) + 1; });
    sections.push(
      el('div', { class: 'card p-5' },
        el('h3', { class: 'text-base font-bold mb-1' }, '⏳ Aging — Past Due Accounts (' + agedAccounts.length + ')'),
        el('p', { class: 'text-xs text-muted- mb-3' }, 'Accounts with Age > 0 (days past due on balance)'),
        el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4' },
          ...Object.entries(byOffice).sort((a, b) => b[1] - a[1]).map(([office, cnt]) =>
            el('div', { class: 'card-2 rounded-lg border border- p-3 text-center' },
              el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: BRANCH_COLORS[office.toUpperCase()] || 'var(--text-muted)' } }, office),
              el('div', { class: 'text-xl font-bold tabular-nums mt-1' }, cnt),
            ),
          ),
        ),
        el('div', { class: 'scroll-x', style: { maxHeight: '300px', overflowY: 'auto' } },
          el('table', { class: 'w-full text-[12px]' },
            el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted- sticky top-0', style: { background: 'var(--card)' } },
              el('tr', {},
                el('th', { class: 'text-left pl-4 pr-2 py-2 font-semibold' }, 'Customer'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Office'),
                el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Rep'),
                el('th', { class: 'text-right px-2 py-2 font-semibold' }, 'Age (days)'),
                el('th', { class: 'text-left pl-2 pr-4 py-2 font-semibold' }, 'Status'),
              ),
            ),
            el('tbody', {},
              ...agedAccounts.sort((a, b) => b.age - a.age).map(s => el('tr', { class: 'border-t border-' },
                el('td', { class: 'pl-4 pr-2 py-2 font-medium' }, s.customer || '—'),
                el('td', { class: 'px-2 py-2 text-muted-' }, s.office || '—'),
                el('td', { class: 'px-2 py-2 text-muted-' }, s.rep || '—'),
                el('td', { class: 'px-2 py-2 text-right tabular-nums font-semibold', style: s.age > 14 ? { color: '#DC2626' } : {} }, s.age),
                el('td', { class: 'pl-2 pr-4 py-2' }, s.status || '—'),
              )),
            ),
          ),
        ),
      ),
    );
  }

  // ── 5. SUBSCRIPTION MIX ──
  const subMix = {};
  rawSales.forEach(s => {
    const sub = s.subscription || 'Unknown';
    if (!subMix[sub]) subMix[sub] = { count: 0, revenue: 0 };
    subMix[sub].count++;
    subMix[sub].revenue += s.contractValue;
  });
  const topSubscriptions = Object.entries(subMix)
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  sections.push(
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-base font-bold mb-4' }, '📦 Subscription Mix'),
      el('div', { class: 'flex flex-col gap-1.5' },
        ...topSubscriptions.map((s, i) => {
          const maxCount = topSubscriptions[0]?.count || 1;
          const barWidth = (s.count / maxCount * 100).toFixed(1);
          return el('div', { class: 'flex items-center gap-3 text-xs' },
            el('div', { class: 'w-[200px] sm:w-[280px] truncate font-medium shrink-0', title: s.name }, s.name),
            el('div', { class: 'flex-1 h-5 rounded-full overflow-hidden', style: { background: 'var(--border)' } },
              el('div', { style: { width: barWidth + '%', height: '100%', background: 'var(--accent)', borderRadius: '999px', transition: 'width .3s' } }),
            ),
            el('div', { class: 'w-12 text-right tabular-nums font-semibold shrink-0' }, fmt.int(s.count)),
            el('div', { class: 'w-20 text-right tabular-nums text-muted- shrink-0' }, fmt.usd0(s.revenue)),
          );
        }),
      ),
    ),
  );

  return sections;
}

// CSV upload button
function csvUploadButton(size) {
  const fileInput = el('input', {
    type: 'file', accept: '.csv,.txt', style: { display: 'none' },
    onchange: (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          state.indicatorsData = parseIndicatorsCsv(ev.target.result);
          state.indicatorsWeek = -1;
          saveDemoData();
          toast('CSV loaded — ' + state.indicatorsData.length + ' rows', 'success');
          mountApp();
        } catch (err) {
          toast('CSV parse error: ' + err.message, 'error');
        }
      };
      reader.readAsText(file);
    },
  });
  return el('button', {
    class: size === 'sm'
      ? 'px-3 py-2 rounded-xl border text-xs font-medium transition hover:brightness-95'
      : 'px-5 py-3 rounded-xl text-sm font-bold transition hover:brightness-95',
    style: size === 'sm'
      ? { borderColor: 'var(--border-2)', color: 'var(--text)' }
      : { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: () => fileInput.click(),
  }, fileInput, size === 'sm' ? '📁 Upload CSV' : '📁 Upload CSV File');
}

// Parse raw CSV text — handles BOTH formats:
//   1. Raw sales report (one row per sale: Customer, Office, Date Sold, Contract, etc.)
//   2. Pre-aggregated indicators (Week, Branch, Sold Accounts, Revenue, etc.)
function parseIndicatorsCsv(text) {
  // Handle quoted CSV fields properly (commas inside quotes, etc.)
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }

  const lines = text.replace(/^\uFEFF/, '').trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const headerRow = parseCsvLine(lines[0]);
  const headers = headerRow.map(h => h.toLowerCase().trim());

  const findCol = (...names) => headers.findIndex(h => names.some(n => h.includes(n)));

  // Detect format: if there's an "Office" or "Customer" column, it's raw sales
  const iOffice    = findCol('office', 'branch');
  const iCustomer  = findCol('customer id', 'customer');
  const iDateSold  = findCol('date sold');
  const iContract  = findCol('contract');
  const iInitPrice = findCol('initial service price', 'initial price');
  const iRecurring = findCol('recurring');
  const iServices  = findCol('services');
  const iContractVal = findCol('contract value');
  const iStatus    = findCol('status');
  const iAPay      = findCol('apay', 'auto pay');
  const iRep       = findCol('sales rep', 'rep');
  const iSub       = findCol('subscription');
  const iActive    = findCol('active');
  const iCancelR   = findCol('cancel reason');
  const iCancelD   = findCol('cancel date');
  const iAge       = findCol('age');
  const iSource    = findCol('source');
  const iCustName  = findCol('customer');

  const isRawSales = iCustomer >= 0 && iDateSold >= 0 && iOffice >= 0;

  if (isRawSales) {
    return parseRawSalesReport(lines, headerRow, headers, {
      iOffice, iDateSold, iContract, iInitPrice, iContractVal, iStatus, iAPay, iRep, iRecurring, iServices,
      iSub, iActive, iCancelR, iCancelD, iAge, iSource, iCustName
    });
  }

  // Fallback: pre-aggregated format
  if (iOffice === -1) throw new Error('No "Office" or "Branch" column found');
  return parsePreAggregated(lines, headers, iOffice);
}

function parseRawSalesReport(lines, headerRow, headers, cols) {
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }

  const parseNum = (s) => parseFloat(String(s || '').replace(/[$,%]/g, '').replace(/,/g, '').trim()) || 0;

  // Parse all sales rows
  const sales = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const office = (c[cols.iOffice] || '').toUpperCase().trim();
    if (!office) continue;
    const dateSold = c[cols.iDateSold] || '';
    // Parse date: "MM/DD/YY HH:MM AM/PM" or "MM/DD/YYYY"
    let dateObj = null;
    if (dateSold) {
      const parts = dateSold.split(' ')[0].split('/');
      if (parts.length === 3) {
        let [m, d, y] = parts.map(Number);
        if (y < 100) y += 2000;
        dateObj = new Date(y, m - 1, d);
      }
    }
    sales.push({
      office,
      date: dateObj,
      customer: cols.iCustName >= 0 ? (c[cols.iCustName] || '').trim() : '',
      subscription: cols.iSub >= 0 ? (c[cols.iSub] || '').trim() : '',
      active: cols.iActive >= 0 ? (c[cols.iActive] || '').trim() : '',
      cancelReason: cols.iCancelR >= 0 ? (c[cols.iCancelR] || '').trim() : '',
      cancelDate: cols.iCancelD >= 0 ? (c[cols.iCancelD] || '').trim() : '',
      age: cols.iAge >= 0 ? parseNum(c[cols.iAge]) : 0,
      source: cols.iSource >= 0 ? (c[cols.iSource] || '').trim() : '',
      contract: parseNum(c[cols.iContract]),
      initialPrice: parseNum(c[cols.iInitPrice]),
      contractValue: parseNum(c[cols.iContractVal]),
      recurring: parseNum(c[cols.iRecurring]),
      services: parseNum(c[cols.iServices]),
      status: (c[cols.iStatus] || '').trim(),
      autoPay: (c[cols.iAPay] || '').trim(),
      rep: (c[cols.iRep] || '').trim(),
      dateSold: dateSold,
    });
  }

  if (!sales.length) throw new Error('No valid sales rows found');

  // Find the earliest date → week 0 start (round to Monday)
  const validDates = sales.filter(s => s.date).map(s => s.date.getTime());
  const minDate = new Date(Math.min(...validDates));
  const weekStart = new Date(minDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday start
  weekStart.setHours(0, 0, 0, 0);

  // Assign week numbers
  sales.forEach(s => {
    if (s.date) {
      s.week = Math.floor((s.date.getTime() - weekStart.getTime()) / (7 * 86400000));
    } else {
      s.week = 0;
    }
  });

  // Group by office + week and aggregate
  const groups = {};
  sales.forEach(s => {
    const key = s.office + '|' + s.week;
    if (!groups[key]) groups[key] = { office: s.office, week: s.week, sales: [] };
    groups[key].sales.push(s);
  });

  // Build indicator rows from groups
  const rows = [];
  for (const g of Object.values(groups)) {
    const ss = g.sales;
    const count = ss.length;
    const revenue = ss.reduce((a, s) => a + s.contractValue, 0);
    const avgInit = count > 0 ? ss.reduce((a, s) => a + s.initialPrice, 0) / count : 0;
    const multiYears = ss.filter(s => s.contract > 12).length;    // 18+24 month contracts
    const twelveMonth = ss.filter(s => s.contract === 12).length; // 12 month contracts
    const autoPayCount = ss.filter(s => s.autoPay && s.autoPay !== 'No').length;
    const uniqueReps = new Set(ss.map(s => s.rep).filter(Boolean)).size;

    // Date label for this week
    const weekStartDate = new Date(weekStart.getTime() + g.week * 7 * 86400000);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * 86400000);
    const dateLabel = (weekStartDate.getMonth() + 1) + '/' + weekStartDate.getDate() + '-' +
                      (weekEndDate.getMonth() + 1) + '/' + weekEndDate.getDate();

    rows.push({
      week: g.week,
      date: dateLabel,
      branch: g.office,
      sold_accounts: count,
      revenue,
      avg_initial: avgInit,
      auto_pay_pct: count > 0 ? autoPayCount / count : 0,
      multi_years: multiYears,
      twelve_month: twelveMonth,
      reps: uniqueReps,
    });
  }

  if (!rows.length) throw new Error('No data after aggregation');

  // Store raw sales for rep-level analytics (cancel analysis, aging, subscription mix, etc.)
  state._indicatorRawSales = sales.map(s => ({
    customer: s.customer || '',
    office: s.office,
    subscription: s.subscription || '',
    active: s.active || '',
    cancelReason: s.cancelReason || '',
    cancelDate: s.cancelDate || '',
    rep: s.rep,
    dateSold: s.dateSold || '',
    status: s.status,
    autoPay: s.autoPay,
    age: s.age || 0,
    source: s.source || '',
    contract: s.contract,
    initialPrice: s.initialPrice,
    contractValue: s.contractValue,
    recurring: s.recurring,
    services: s.services,
  }));

  return rows;
}

function parsePreAggregated(lines, headers, iOffice) {
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }
  const findCol = (...names) => headers.findIndex(h => names.some(n => h.includes(n)));
  const parseNum = (s) => parseFloat(String(s || '').replace(/[$,%]/g, '').replace(/,/g, '').trim()) || 0;
  const parsePct = (s) => { const v = parseNum(s); return v > 1 ? v / 100 : v; };

  const iWeek     = findCol('week');
  const iDate     = findCol('date');
  const iSold     = findCol('sold account', 'sold');
  const iRevenue  = findCol('revenue', 'sold revenue');
  const iAvgInit  = findCol('avg', 'initial');
  const iAutoPay  = findCol('auto pay');
  const iAppruv   = findCol('appruv');
  const iMulti    = findCol('multi');
  const iReps     = findCol('reps');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    const branch = (cols[iOffice] || '').toUpperCase().trim();
    if (!branch || branch === 'RIDD') continue;
    rows.push({
      week:          iWeek >= 0 ? parseInt(cols[iWeek]) || 0 : 0,
      date:          iDate >= 0 ? cols[iDate] || '' : '',
      branch,
      sold_accounts: iSold >= 0 ? parseNum(cols[iSold]) : 0,
      revenue:       iRevenue >= 0 ? parseNum(cols[iRevenue]) : 0,
      avg_initial:   iAvgInit >= 0 ? parseNum(cols[iAvgInit]) : 0,
      auto_pay_pct:  iAutoPay >= 0 ? parsePct(cols[iAutoPay]) : 0,
      multi_years:   iMulti >= 0 ? parseNum(cols[iMulti]) : 0,
      twelve_month:  0, // not available in pre-aggregated format
      reps:          iReps >= 0 ? parseNum(cols[iReps]) : 0,
    });
  }
  if (!rows.length) throw new Error('No valid data rows found');
  return rows;
}

// Chart rendering
// Track chart instances so we can destroy them before re-creating (prevents stacking)
const _chartInstances = {};

function indicatorChart(title, data, branches, metricKey, weeks, invertForRanking = false) {
  const canvasId = 'chart-' + metricKey;
  const isRanking = metricKey === '_power_ranking';
  const chartHeight = isRanking ? '320px' : '260px';

  // Wrapper with explicit height so Chart.js respects it
  const canvasWrap = el('div', { style: { position: 'relative', height: chartHeight, width: '100%' } });
  const canvas = el('canvas', { id: canvasId });
  canvasWrap.append(canvas);

  const container = el('div', { class: 'card p-5' },
    el('h3', { class: 'text-sm font-bold mb-3' }, title),
    canvasWrap,
  );

  // Build chart after DOM insertion
  setTimeout(() => {
    const cvs = document.getElementById(canvasId);
    if (!cvs || typeof Chart === 'undefined') return;

    // Destroy previous instance if it exists
    if (_chartInstances[canvasId]) {
      _chartInstances[canvasId].destroy();
      delete _chartInstances[canvasId];
    }

    const datasets = branches.map(branch => {
      const values = weeks.map(w => {
        if (isRanking) {
          const weekData = {};
          branches.forEach(b => {
            const bRows = data.filter(r => r.branch === b && r.week <= w);
            const sold = bRows.reduce((a, r) => a + r.sold_accounts, 0);
            const rev = bRows.reduce((a, r) => a + r.revenue, 0);
            const multi = bRows.reduce((a, r) => a + r.multi_years, 0);
            const reps = Math.max(1, ...bRows.map(r => r.reps));
            const twelve = bRows.reduce((a, r) => a + (r.twelve_month || 0), 0);
            const ctTotal = twelve + multi;
            weekData[b] = {
              sold_accounts: sold, revenue: rev,
              avg_initial: sold > 0 ? bRows.reduce((a, r) => a + r.avg_initial * r.sold_accounts, 0) / sold : 0,
              acv: sold > 0 ? rev / sold : 0,
              pra: rev / reps,
              multi_year_pct: ctTotal > 0 ? twelve / ctTotal : 0,
              auto_pay_pct: sold > 0 ? bRows.reduce((a, r) => a + r.auto_pay_pct * r.sold_accounts, 0) / sold : 0,
              reps,
            };
          });
          const pts = {};
          branches.forEach(b => pts[b] = 0);
          INDICATOR_METRICS.forEach(m => {
            const sorted = branches.slice().sort((a, b) => (weekData[b]?.[m.key] || 0) - (weekData[a]?.[m.key] || 0));
            sorted.forEach((b, i) => { pts[b] += branches.length - i; });
          });
          const ranked = branches.slice().sort((a, b) => (pts[b] || 0) - (pts[a] || 0));
          return ranked.indexOf(branch) + 1;
        }

        const weekRow = data.find(r => r.branch === branch && r.week === w);
        if (!weekRow) return null;
        const sold = weekRow.sold_accounts;
        if (metricKey === 'pra') return weekRow.reps > 0 ? weekRow.revenue / weekRow.reps : 0;
        if (metricKey === 'acv') return sold > 0 ? weekRow.revenue / sold : 0;
        if (metricKey === 'revenue') return weekRow.revenue;
        return weekRow[metricKey] || 0;
      });

      return {
        label: branch.split(' ').map(w => w[0] + w.slice(1).toLowerCase()).join(' '),
        data: values,
        borderColor: BRANCH_COLORS[branch] || '#666',
        backgroundColor: 'transparent',
        tension: 0.3,
        pointRadius: 3,
        pointHoverRadius: 5,
        borderWidth: 2,
      };
    });

    const isDark = state.theme === 'dark';
    const gridColor = isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const tickColor = isDark ? 'rgba(255,255,255,.5)' : 'rgba(0,0,0,.5)';

    _chartInstances[canvasId] = new Chart(cvs.getContext('2d'), {
      type: 'line',
      data: {
        labels: weeks.map(w => {
          const row = data.find(r => r.week === w && r.date);
          return row?.date ? ('Wk ' + w + '\n' + row.date) : 'Wk ' + w;
        }),
        datasets,
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        layout: { padding: { top: 10, right: 20, bottom: 5, left: 5 } },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { boxWidth: 10, boxHeight: 10, padding: 12, font: { size: 11 }, usePointStyle: true },
          },
          tooltip: { backgroundColor: '#1D1D1D', titleFont: { size: 12 }, bodyFont: { size: 11 }, padding: 10, cornerRadius: 8,
            callbacks: {
              title: (items) => {
                if (!items.length) return '';
                const idx = items[0].dataIndex;
                const w = weeks[idx];
                const row = data.find(r => r.week === w && r.date);
                return 'Week ' + w + (row?.date ? ' (' + row.date + ')' : '');
              },
            },
          },
        },
        scales: {
          y: {
            reverse: isRanking,
            beginAtZero: !isRanking,
            grid: { color: isRanking ? 'rgba(141,198,63,.15)' : gridColor },
            ticks: { font: { size: 10 }, color: tickColor,
              callback: isRanking ? undefined : (metricKey === 'revenue' ? (v => '$' + (v >= 1000 ? Math.round(v/1000) + 'K' : v)) : undefined),
            },
            ...(isRanking ? { min: 0.5, max: branches.length + 0.5, ticks: { stepSize: 1, font: { size: 10 }, color: tickColor, callback: v => Number.isInteger(v) && v >= 1 && v <= branches.length ? '#' + v : '' } } : {}),
          },
          x: { grid: { display: false }, ticks: { font: { size: 9 }, color: tickColor, maxRotation: 0 } },
        },
      },
    });
  }, 150);

  return container;
}

function viewHistory() {
  const rows = [...state.mySales].sort((a, b) => new Date(b.sold_date) - new Date(a.sold_date));
  const filterState = { q: '', status: '', source: '' };

  const container = el('div', { class: 'flex flex-col gap-4 max-w-6xl' });

  container.append(
    el('div', {},
      el('h1', { class: 'text-3xl font-bold' }, 'Sales History'),
      el('p', { class: 'text-battle-2 text-sm mt-1' }, 'Every sale on record, filterable and exportable.'),
    ),
  );

  const tableHost = el('div', {});
  const filterBar = el('div', { class: 'card p-3 flex flex-wrap gap-2 items-center' },
    el('input', {
      class: 'flex-1 min-w-[200px] rounded-lg border px-3 py-2 text-sm',
      placeholder: 'Search customer or notes…',
      oninput: e => { filterState.q = e.target.value.toLowerCase(); renderTable(); },
    }),
    el('select', {
      class: 'rounded-lg border px-3 py-2 text-sm',
      onchange: e => { filterState.status = e.target.value; renderTable(); },
    },
      el('option', { value: '' }, 'All statuses'),
      el('option', { value: 'pending' },        'Pending'),
      el('option', { value: 'serviced' },       'Serviced'),
      el('option', { value: 'cancelled' },      'Cancelled'),
      el('option', { value: 'below_minimums' }, 'Below Minimums'),
      el('option', { value: 'nsf' },            'NSF'),
      el('option', { value: 'not_payable' },    'Not Payable'),
      el('option', { value: 'reschedule' },     'Reschedule'),
    ),
    el('select', {
      class: 'rounded-lg border px-3 py-2 text-sm',
      onchange: e => { filterState.source = e.target.value; renderTable(); },
    },
      el('option', { value: '' }, 'All sources'),
      ...state.sources.map(s => el('option', { value: s.id }, s.name)),
    ),
    el('button', {
      class: 'px-3 py-2 rounded-lg border border-battleship text-battle-2 hover:text-lime hover:border-lime text-sm transition',
      onclick: () => downloadCsv(filterRows()),
    }, 'Export CSV'),
  );

  function filterRows() {
    return rows.filter(s => {
      if (filterState.q) {
        const hay = (s.customer_name + ' ' + (s.notes || '')).toLowerCase();
        if (!hay.includes(filterState.q)) return false;
      }
      if (filterState.status && s.audit_status !== filterState.status) return false;
      if (filterState.source && s.source_id !== Number(filterState.source)) return false;
      return true;
    });
  }

  function renderTable() {
    const r = filterRows();
    tableHost.innerHTML = '';
    tableHost.append(
      el('div', { class: 'text-xs text-battle-2 px-1 py-2' }, `${r.length} record${r.length === 1 ? '' : 's'}`),
      el('div', { class: 'card overflow-hidden' },
        el('div', { class: 'scroll-x' },
          el('table', { class: 'w-full text-sm' },
            el('thead', { class: 'text-[10px] uppercase tracking-widest text-battleship bg-eerie3' },
              el('tr', {},
                el('th', { class: 'text-left px-3 py-2' }, 'Customer'),
                el('th', { class: 'text-left px-3 py-2 desktop-only' }, 'Cust #'),
                el('th', { class: 'text-left px-3 py-2 desktop-only' }, 'Office'),
                el('th', { class: 'text-left px-3 py-2' }, 'Service'),
                el('th', { class: 'text-left px-3 py-2 desktop-only' }, 'Source'),
                el('th', { class: 'text-right px-3 py-2' }, 'Initial'),
                el('th', { class: 'text-right px-3 py-2 desktop-only' }, 'Monthly'),
                el('th', { class: 'text-right px-3 py-2' }, 'Revenue'),
                el('th', { class: 'text-left px-3 py-2' }, 'Sold'),
                el('th', { class: 'text-left px-3 py-2' }, 'Status'),
              ),
            ),
            el('tbody', {}, r.length === 0
              ? el('tr', {}, el('td', { colspan: 10, class: 'text-center text-battle-2 py-8' }, 'No results.'))
              : r.map(s => el('tr', { class: 'border-t border-eerie3' },
                  el('td', { class: 'px-3 py-2.5 font-medium' }, s.customer_name),
                  el('td', { class: 'px-3 py-2.5 text-battle-2 desktop-only' }, s.customer_number || '—'),
                  el('td', { class: 'px-3 py-2.5 text-battle-2 desktop-only' }, nameFromId(state.offices, s.office_id)),
                  el('td', { class: 'px-3 py-2.5 text-battle-2' }, nameFromId(state.serviceTypes, s.service_type_id)),
                  el('td', { class: 'px-3 py-2.5 text-battle-2 desktop-only' }, nameFromId(state.sources, s.source_id)),
                  el('td', { class: 'px-3 py-2.5 text-right tabular-nums' }, fmt.usd(s.initial_amount)),
                  el('td', { class: 'px-3 py-2.5 text-right tabular-nums desktop-only' }, fmt.usd(s.monthly_amount)),
                  el('td', { class: 'px-3 py-2.5 text-right tabular-nums font-medium' }, fmt.usd(s.revenue_amount)),
                  el('td', { class: 'px-3 py-2.5 text-battle-2 tabular-nums' }, fmt.dateShort(s.sold_date)),
                  el('td', { class: 'px-3 py-2.5' }, statusChip(s.audit_status)),
                )),
            ),
          ),
        ),
      ),
    );
  }

  container.append(filterBar, tableHost);
  renderTable();
  return container;
}

// ──────────────────────────────────────────────────────────────────────────
// VIEW: ADMIN — audit queue, competitions editor
// ──────────────────────────────────────────────────────────────────────────
function viewAdmin() {
  if (!state.adminSection) state.adminSection = 'users';

  const sections = [
    ['goals',   'Goals',         '🎯'],
    ['users',   'Users',         '👥'],
    ['comps',   'Competitions',  '🏆'],
    ['slack',   'Slack',         '💬'],
    ['pricing', 'Pricing',       '💵'],
    ['backup',  'Backup',        '💾'],
  ];

  const sidebar = el('aside', { class: 'rounded-2xl p-2 flex flex-col gap-1 shrink-0', style: { background: 'var(--card)', border: '1px solid var(--border)', width: '220px' } },
    el('div', { class: 'px-3 py-2 text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Settings'),
    ...sections.map(([k, label, icon]) => el('button', {
      class: 'flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition text-left',
      style: state.adminSection === k
        ? { background: 'var(--bg-subtle)', color: 'var(--text)', fontWeight: '600' }
        : { color: 'var(--text-muted)' },
      onmouseenter: (e) => { if (state.adminSection !== k) e.currentTarget.style.background = 'var(--bg-subtle)'; },
      onmouseleave: (e) => { if (state.adminSection !== k) e.currentTarget.style.background = 'transparent'; },
      onclick: () => { state.adminSection = k; mountApp(); },
    }, el('span', { class: 'text-base' }, icon), el('span', {}, label))),
  );

  const sectionRenderers = {
    goals:   adminGoals,
    users:   adminReps,
    comps:   adminCompetitions,
    slack:   adminSlack,
    pricing: adminPricing,
    backup:  adminBackup,
  };
  const view = sectionRenderers[state.adminSection] || adminReps;
  const body = el('div', { class: 'flex-1 min-w-0' }, view());

  return el('div', { class: 'flex gap-5 max-w-6xl mx-auto' }, sidebar, body);
}

// ── Placeholder settings sections (filled in later as needed) ──
function adminGoals() {
  const g = state.companyGoal;
  // Ensure sub-goals exist with defaults
  g.new_amount    = g.new_amount    ?? Math.round(g.amount * 0.75);
  g.renewal_amount= g.renewal_amount?? Math.round(g.amount * 0.25);
  g.quarterly         = g.quarterly         || [g.amount/4, g.amount/4, g.amount/4, g.amount/4];
  g.quarterly_new     = g.quarterly_new     || [g.new_amount/4, g.new_amount/4, g.new_amount/4, g.new_amount/4];
  g.quarterly_renewal = g.quarterly_renewal || [g.renewal_amount/4, g.renewal_amount/4, g.renewal_amount/4, g.renewal_amount/4];
  g.stretch       = g.stretch       || 0;
  const persist = () => saveDemoData();

  // Live YTD numbers for the progress cards
  const ytd = goalYtdRevenue(true);

  return el('div', { class: 'flex flex-col gap-5' },
    el('h2', { class: 'text-xl font-bold' }, 'Goals'),

    // ── Total / New / Renewal targets ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Company Annual Revenue Targets'),
      el('p', { class: 'text-xs text-muted- mb-4' }, 'Total = New + Renewal. Adjust the New and Renewal targets — the Total updates automatically.'),

      el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-4 mb-4' },
        // Total (computed, read-only)
        goalTargetCard('Total Revenue', g.amount, ytd.total, null, true),
        // New (editable)
        goalTargetCard('New Revenue', g.new_amount, ytd.new, (val) => {
          g.new_amount = val;
          g.amount = g.new_amount + g.renewal_amount;
          g.quarterly = [g.amount/4, g.amount/4, g.amount/4, g.amount/4];
          g.quarterly_new = [val/4, val/4, val/4, val/4];
          persist(); mountApp();
        }),
        // Renewal (editable)
        goalTargetCard('Renewal Revenue', g.renewal_amount, ytd.renewal, (val) => {
          g.renewal_amount = val;
          g.amount = g.new_amount + g.renewal_amount;
          g.quarterly = [g.amount/4, g.amount/4, g.amount/4, g.amount/4];
          g.quarterly_renewal = [val/4, val/4, val/4, val/4];
          persist(); mountApp();
        }),
      ),

    ),

    // ── Quarterly milestones — Total, New, Renewal ──
    quarterlyMilestonesCard('Total Quarterly', g, 'quarterly', g.amount, persist, true),
    quarterlyMilestonesCard('New Revenue Quarterly', g, 'quarterly_new', g.new_amount, persist, false),
    quarterlyMilestonesCard('Renewal Revenue Quarterly', g, 'quarterly_renewal', g.renewal_amount, persist, false),

    el('div', { class: 'text-[11px] text-muted-' }, 'Per-rep goals are editable in ', el('strong', {}, 'Users'), '.'),
  );
}

// Helper card for the Goals section — shows target, YTD actual, and a mini progress bar
function goalTargetCard(label, target, actual, onInput, readOnly = false) {
  const pct = target > 0 ? Math.min(1, actual / target) : 0;
  return el('div', { class: 'card-2 rounded-xl border border- p-4' },
    el('div', { class: 'text-[10px] uppercase tracking-widest text-muted- font-semibold mb-2' }, label),
    readOnly
      ? el('div', { class: 'text-2xl font-black tabular-nums mb-1' }, fmt.usd0(target))
      : el('div', { class: 'relative mb-1' },
          el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '$'),
          el('input', {
            type: 'text',
            inputmode: 'numeric',
            class: 'w-full rounded-lg border pl-7 pr-3 py-2 text-sm font-bold text-right',
            value: target,
            onchange: (e) => onInput(parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0),
          }),
        ),
    el('div', { class: 'goal-track mb-1', style: { height: '6px' } },
      el('div', { class: 'goal-fill', style: { width: (pct * 100).toFixed(1) + '%' } }),
    ),
    el('div', { class: 'flex items-center justify-between text-[10px]' },
      el('span', { class: 'text-muted-' }, fmt.usd0(actual) + ' YTD'),
      el('span', { class: 'font-semibold', style: { color: 'var(--accent)' } }, fmt.pct(pct)),
    ),
  );
}

function quarterlyMilestonesCard(title, goalObj, key, annualTarget, persist, readOnly = false) {
  const qLabels = ['Q1', 'Q2', 'Q3', 'Q4'];
  const arr = goalObj[key];

  // If read-only, recompute from new + renewal each quarter
  if (readOnly && goalObj.quarterly_new && goalObj.quarterly_renewal) {
    for (let i = 0; i < 4; i++) {
      arr[i] = (goalObj.quarterly_new[i] || 0) + (goalObj.quarterly_renewal[i] || 0);
    }
  }

  const sum = arr.reduce((a, b) => a + b, 0);
  const match = Math.round(sum) === Math.round(annualTarget);

  return el('div', { class: 'card p-5' },
    el('div', { class: 'flex items-center justify-between mb-3' },
      el('h3', { class: 'text-sm font-bold' }, title),
      el('div', { class: 'text-xs' },
        el('span', { class: 'text-muted-' }, 'Sum: '),
        el('strong', {}, fmt.usd0(sum)),
        match
          ? el('span', { class: 'ml-1.5', style: { color: 'var(--accent)' } }, '✓')
          : el('span', { class: 'text-amber-500 ml-1.5' }, '≠ ' + fmt.usd0(annualTarget)),
      ),
    ),
    el('div', { class: 'grid grid-cols-2 sm:grid-cols-4 gap-3' },
      ...qLabels.map((label, i) => el('label', { class: 'block' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, label),
        readOnly
          ? el('div', { class: 'rounded-lg border px-3 py-2 text-sm text-right font-semibold tabular-nums', style: { background: 'var(--bg-subtle)', color: 'var(--text-muted)' } },
              '$' + Math.round(arr[i]).toLocaleString(),
            )
          : el('div', { class: 'relative' },
              el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '$'),
              el('input', {
                type: 'text',
                inputmode: 'numeric',
                class: 'w-full rounded-lg border pl-7 pr-3 py-2 text-sm text-right',
                value: Math.round(arr[i]),
                onchange: (e) => {
                  arr[i] = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0;
                  // Recompute total quarterly from new + renewal
                  if (goalObj.quarterly_new && goalObj.quarterly_renewal) {
                    for (let j = 0; j < 4; j++) {
                      goalObj.quarterly[j] = (goalObj.quarterly_new[j] || 0) + (goalObj.quarterly_renewal[j] || 0);
                    }
                    goalObj.amount = goalObj.quarterly.reduce((a, b) => a + b, 0);
                  }
                  persist(); mountApp();
                },
              }),
            ),
      )),
    ),
  );
}

function adminPricing() {
  const s = state.appSettings || (state.appSettings = {});

  // Commission rates per contract type (exclude Commercial + Paid in Full — those are separate overrides)
  const validCtIds = new Set(state.contractTypes.map(ct => ct.id));
  if (!s.contract_commissions) {
    s.contract_commissions = state.contractTypes.map(ct => ({ contract_type_id: ct.id, name: ct.name, rate: 7.0 }));
  } else {
    s.contract_commissions = s.contract_commissions.filter(cc => validCtIds.has(cc.contract_type_id));
  }

  // Below minimums multiplier (applied to the contract rate)
  s.below_min_multiplier = s.below_min_multiplier ?? 50; // 50% = half commission

  // Commercial + Paid in Full override rates (override the contract type base rate when checked)
  s.commercial_rate = s.commercial_rate ?? 7.0;
  s.paid_in_full_rate = s.paid_in_full_rate ?? 7.0;

  const persist = () => saveDemoData();

  return el('div', { class: 'flex flex-col gap-5' },
    el('h2', { class: 'text-xl font-bold' }, 'Pricing'),

    // ── Status-based pay rules ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Pay by Status'),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'How audit status affects commission payout.'),
      el('div', { class: 'flex flex-col gap-2' },
        el('div', { class: 'flex items-center justify-between py-2 border-b', style: { borderColor: 'var(--border)' } },
          el('div', {},
            el('div', { class: 'text-sm font-semibold' }, 'Serviced'),
            el('div', { class: 'text-xs text-muted-' }, 'Full commission — account has been audited and serviced'),
          ),
          el('div', { class: 'text-sm font-bold', style: { color: 'var(--accent)' } }, '100%'),
        ),
        el('div', { class: 'flex items-center justify-between py-2 border-b', style: { borderColor: 'var(--border)' } },
          el('div', {},
            el('div', { class: 'text-sm font-semibold' }, 'Below Minimums'),
            el('div', { class: 'text-xs text-muted-' }, 'Reduced commission — account audited but below service minimums'),
          ),
          el('div', { class: 'flex items-center gap-1' },
            el('input', {
              type: 'text',
              inputmode: 'numeric',
              class: 'rounded-lg border px-2 py-1.5 text-sm font-bold w-16 text-right',
              value: s.below_min_multiplier,
              onchange: e => { s.below_min_multiplier = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            el('span', { class: 'text-sm text-muted-' }, '%'),
          ),
        ),
        el('div', { class: 'flex items-center justify-between py-2' },
          el('div', {},
            el('div', { class: 'text-sm font-semibold' }, 'NSF / Cancelled / Not Payable'),
            el('div', { class: 'text-xs text-muted-' }, 'No commission paid'),
          ),
          el('div', { class: 'text-sm font-bold text-muted-' }, '0%'),
        ),
      ),
    ),

    // ── Paid in Full override ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center justify-between' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, 'Paid in Full Override'),
          el('p', { class: 'text-xs text-muted- mt-0.5' }, 'Overrides the contract type base rate when the "Paid in Full" box is checked on a sale. No hold on backend — full commission paid upfront.'),
        ),
        el('div', { class: 'flex items-center gap-1 shrink-0 ml-4' },
          el('input', {
            type: 'text', inputmode: 'numeric',
            class: 'rounded-lg border px-2 py-1.5 text-sm font-bold w-16 text-right',
            value: s.paid_in_full_rate,
            onchange: e => { s.paid_in_full_rate = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
          }),
          el('span', { class: 'text-sm text-muted-' }, '%'),
        ),
      ),
    ),

    // ── Commercial override ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center justify-between' },
        el('div', {},
          el('h3', { class: 'text-sm font-bold' }, 'Commercial Override'),
          el('p', { class: 'text-xs text-muted- mt-0.5' }, 'Overrides the contract type base rate when the "Commercial" box is checked on a sale. Typically for accounts with ACV > $2,000 on commercial properties.'),
        ),
        el('div', { class: 'flex items-center gap-1 shrink-0 ml-4' },
          el('input', {
            type: 'text', inputmode: 'numeric',
            class: 'rounded-lg border px-2 py-1.5 text-sm font-bold w-16 text-right',
            value: s.commercial_rate,
            onchange: e => { s.commercial_rate = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
          }),
          el('span', { class: 'text-sm text-muted-' }, '%'),
        ),
      ),
    ),

    // ── Commission by Contract Type ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Commission by Contract Type'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Base upfront commission rate per contract type. The per-rep Commission Bump (in Users) is added on top.',
      ),
      el('div', { class: 'flex flex-col gap-2' },
        el('div', { class: 'grid grid-cols-[1.5fr_1fr] gap-2 text-[10px] uppercase tracking-widest text-muted- font-semibold px-1' },
          el('div', {}, 'Contract Type'),
          el('div', {}, 'Base Rate'),
        ),
        ...s.contract_commissions.map(cc => el('div', { class: 'grid grid-cols-[1.5fr_1fr] gap-2 items-center' },
          el('div', { class: 'text-sm py-2 px-1' }, cc.name),
          el('div', { class: 'relative' },
            el('input', {
              type: 'text',
              inputmode: 'numeric',
              class: 'w-full rounded-lg border pl-3 pr-7 py-2 text-sm',
              value: cc.rate,
              onchange: e => { cc.rate = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
            }),
            el('span', { class: 'absolute right-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '%'),
          ),
        )),
      ),
    ),

    // ── Quarterly Bonus ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Quarterly Bonus'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'A flat bonus amount added to the pay stub each quarter when you run payroll. Configure the amount — you add it manually when processing the quarterly payroll cycle.',
      ),
      el('div', { class: 'flex items-center gap-3' },
        el('label', { class: 'text-sm font-medium flex-1' }, 'Bonus per quarter'),
        el('div', { class: 'relative' },
          el('span', { class: 'absolute left-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '$'),
          el('input', {
            type: 'text',
            inputmode: 'numeric',
            class: 'rounded-lg border pl-7 pr-3 py-2 text-sm w-40 text-right',
            value: s.quarterly_bonus || '',
            placeholder: 'e.g. 500',
            onchange: e => { s.quarterly_bonus = parseFloat(e.target.value.replace(/[^0-9.]/g, '')) || 0; persist(); },
          }),
        ),
      ),
    ),

  );
}

// Look up the commission rate for a sale based on:
//   1. Contract type rate (from Pricing settings)
//   2. Volume tier override (if rep's YTD revenue crosses a threshold)
//   3. Per-rep bump (from Users settings)
//   4. Status multiplier: serviced = 100%, below_minimums = configurable (default 50%)
function getCommissionRate(repId, sale) {
  const s = state.appSettings || {};
  const BASE = 0.07;
  const profile = state.allProfiles.find(p => p.id === repId) || state.profile;

  // 1. Contract type rate (or Commercial/Paid in Full override)
  let baseRate = BASE;
  if (sale?.paid_in_full && s.paid_in_full_rate != null) {
    baseRate = s.paid_in_full_rate / 100;
  } else if (sale?.is_commercial && s.commercial_rate != null) {
    baseRate = s.commercial_rate / 100;
  } else if (sale?.contract_type_id && s.contract_commissions) {
    const cc = s.contract_commissions.find(c => c.contract_type_id === sale.contract_type_id);
    if (cc) baseRate = cc.rate / 100;
  }

  // 2. Volume tier override (if any)
  const tiers = (s.commission_tiers || []).slice().sort((a, b) => b.min_revenue - a.min_revenue);
  if (tiers.length) {
    const yearStart = new Date(new Date().getFullYear(), 0, 1);
    const EXCLUDE = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
    const ytdRev = state.allSales
      .filter(sl => sl.rep_id === repId && !EXCLUDE.has(sl.audit_status) && new Date(sl.sold_date + 'T00:00') >= yearStart)
      .reduce((a, sl) => a + Number(sl.revenue_amount || 0), 0);
    for (const t of tiers) {
      if (ytdRev >= t.min_revenue) {
        baseRate = Math.max(baseRate, t.rate / 100); // tier overrides if higher
        break;
      }
    }
  }

  // 3. Per-rep bump
  const bump = Math.max(0, Number(profile?.upfront_commission_rate || BASE) - BASE);
  let rate = baseRate + bump;

  // 4. Status multiplier
  if (sale?.audit_status === 'below_minimums') {
    const mult = (s.below_min_multiplier ?? 50) / 100;
    rate = rate * mult;
  }

  return Math.round(rate * 10000) / 10000;
}

function adminBackup() {
  const log = state.auditLog || [];

  return el('div', { class: 'flex flex-col gap-5' },
    el('h2', { class: 'text-xl font-bold' }, 'Backup'),

    // ── Activity Log ──
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-5 py-3 border-b flex items-center justify-between', style: { borderColor: 'var(--border)' } },
        el('h3', { class: 'text-sm font-bold' }, 'Activity Log (' + log.length + ')'),
        log.length > 0 && el('button', {
          class: 'text-xs text-muted- hover:text-red-500 transition',
          onclick: () => { state.auditLog = []; saveDemoData(); mountApp(); },
        }, 'Clear log'),
      ),
      log.length === 0
        ? el('div', { class: 'p-6 text-center text-muted- text-sm' }, 'No activity yet. Log a sale to start the trail.')
        : el('div', { class: 'scroll-x', style: { maxHeight: '400px', overflowY: 'auto' } },
            el('table', { class: 'w-full text-[12px]' },
              el('thead', { class: 'text-[9px] uppercase tracking-wider text-muted- sticky top-0 bg-card-' },
                el('tr', {},
                  el('th', { class: 'text-left pl-5 pr-2 py-2 font-semibold' }, 'Time'),
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Action'),
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Customer'),
                  el('th', { class: 'text-left px-2 py-2 font-semibold' }, 'Status'),
                  el('th', { class: 'text-left pl-2 pr-5 py-2 font-semibold' }, 'By'),
                ),
              ),
              el('tbody', {},
                log.slice(0, 50).map(entry => {
                  const actionLabels = {
                    sale_logged: 'Logged',
                    audit: 'Audited',
                    staged: 'Staged',
                    payroll_processed: 'Processed',
                  };
                  const t = new Date(entry.timestamp);
                  const timeStr = t.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) + ' ' +
                    t.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
                  return el('tr', { class: 'border-t border-' },
                    el('td', { class: 'pl-5 pr-2 py-2 text-muted- tabular-nums whitespace-nowrap' }, timeStr),
                    el('td', { class: 'px-2 py-2 font-medium whitespace-nowrap' },
                      el('span', {
                        class: 'chip',
                        style: {
                          background: entry.action === 'sale_logged' ? 'rgba(141,198,63,.12)' :
                                     entry.action === 'audit' ? 'rgba(234,88,12,.1)' :
                                     entry.action === 'staged' ? 'rgba(14,165,233,.1)' :
                                     'rgba(141,198,63,.18)',
                          color: entry.action === 'sale_logged' ? '#5F8A1F' :
                                 entry.action === 'audit' ? '#B45309' :
                                 entry.action === 'staged' ? '#0284C7' :
                                 '#5F8A1F',
                        },
                      }, actionLabels[entry.action] || entry.action),
                    ),
                    el('td', { class: 'px-2 py-2 truncate max-w-[140px]' }, entry.customer_name || '—'),
                    el('td', { class: 'px-2 py-2 text-muted- whitespace-nowrap' },
                      entry.old_status && entry.new_status ? (entry.old_status + ' → ' + entry.new_status) :
                      entry.new_status || (entry.detail || '—'),
                    ),
                    el('td', { class: 'pl-2 pr-5 py-2 text-muted- whitespace-nowrap' }, entry.by_user || '—'),
                  );
                }),
              ),
            ),
          ),
    ),

    // ── Export / Reset ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-3' }, 'Data Export & Reset'),
      el('div', { class: 'flex gap-2 flex-wrap' },
      el('button', {
        class: 'px-4 py-2 rounded-lg text-sm font-semibold',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => {
          const data = JSON.stringify({
            mySales: state.mySales, allSales: state.allSales,
            competitions: state.competitions, compRules: state.compRules, compProgress: state.compProgress,
            allProfiles: state.allProfiles, companyGoal: state.companyGoal, appSettings: state.appSettings,
          }, null, 2);
          const blob = new Blob([data], { type: 'application/json' });
          const url = URL.createObjectURL(blob);
          const a = el('a', { href: url, download: `ridd-backup-${new Date().toISOString().slice(0,10)}.json` });
          document.body.append(a); a.click(); a.remove();
          URL.revokeObjectURL(url);
        },
      }, 'Export JSON'),
      el('button', {
        class: 'px-4 py-2 rounded-lg text-sm font-semibold border',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => {
          if (confirm('Clear all demo sales, competitions, and settings? This cannot be undone.')) {
            clearDemoData();
          }
        },
      }, 'Reset Demo Data'),
    ),
    ),
  );
}

function adminSlack() {
  const s = state.appSettings || (state.appSettings = {});
  s.slack_bot_token = s.slack_bot_token || '';
  if (!s.slack_channels) s.slack_channels = [
    { id: 1, name: '#insidesales', webhook: '' },
  ];
  s.first_blood = s.first_blood || {
    enabled: true,
    message: '[Rep name] first blood today!',
    image_url: 'https://i.imgur.com/TjjGnM1.png',
  };
  s.daily_update = s.daily_update || {
    enabled: true,
    send_time: '17:00',
    include_week: true,
    include_month: true,
    include_year: true,
  };

  const persist = () => saveDemoData();

  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile];

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-center justify-between mb-1' },
      el('h2', { class: 'text-xl font-bold' }, 'Slack'),
    ),

    // ── Bot Token ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Slack Bot Token'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Used to send pay stub DMs to reps. Create a Slack App at ',
        el('a', { href: 'https://api.slack.com/apps', target: '_blank', style: { color: 'var(--accent)' } }, 'api.slack.com/apps'),
        ', add the ', el('code', { style: { color: 'var(--accent)' } }, 'chat:write'), ' scope, and paste the Bot Token here.',
      ),
      el('div', { class: 'flex gap-2' },
        el('input', {
          type: 'password',
          class: 'flex-1 rounded-lg border px-3 py-2 text-sm font-mono',
          placeholder: 'xoxb-...',
          value: s.slack_bot_token,
          oninput: (e) => { s.slack_bot_token = e.target.value; persist(); },
        }),
        el('button', {
          class: 'px-4 py-2 rounded-lg text-sm font-semibold border',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: () => toast('Saved', 'success'),
        }, 'Save'),
        el('button', {
          class: 'px-4 py-2 rounded-lg text-sm font-semibold border',
          style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
          onclick: () => toast('Test message sent (demo)', 'success'),
        }, 'Test'),
      ),
    ),

    // ── Channels (webhooks) ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-3' }, 'Channels'),
      el('div', { class: 'flex flex-col gap-2' },
        ...s.slack_channels.map((ch, i) => el('div', { class: 'flex items-center gap-3' },
          el('input', {
            class: 'rounded-lg border px-3 py-2 text-sm w-32',
            value: ch.name,
            oninput: (e) => { ch.name = e.target.value; persist(); },
          }),
          el('input', {
            class: 'flex-1 rounded-lg border px-3 py-2 text-sm',
            placeholder: 'Webhook URL...',
            value: ch.webhook,
            oninput: (e) => { ch.webhook = e.target.value; persist(); },
          }),
          el('button', {
            class: 'text-xs text-muted- hover:text-red-500 transition px-2',
            onclick: () => { s.slack_channels.splice(i, 1); persist(); mountApp(); },
            title: 'Remove',
          }, '×'),
        )),
      ),
      el('button', {
        class: 'mt-3 px-3 py-1.5 rounded-lg border text-xs font-medium',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => {
          const nextId = Math.max(0, ...s.slack_channels.map(c => c.id)) + 1;
          s.slack_channels.push({ id: nextId, name: '#new-channel', webhook: '' });
          persist();
          mountApp();
        },
      }, '+ Add Channel'),
    ),

    // ── First Blood ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center gap-2 mb-1' },
        el('span', { class: 'text-base' }, '🩸'),
        el('h3', { class: 'text-sm font-bold' }, 'First Blood'),
      ),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'Fires automatically when the first sale of the day is logged.'),
      el('label', { class: 'flex items-center gap-2 mb-4 text-sm' },
        el('input', {
          type: 'checkbox',
          class: 'accent-lime w-4 h-4',
          checked: s.first_blood.enabled,
          onchange: (e) => { s.first_blood.enabled = e.target.checked; persist(); },
        }),
        'Enable First Blood message',
      ),
      el('label', { class: 'block text-sm mb-3' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, 'Message Text'),
        el('div', { class: 'flex items-center gap-2' },
          el('span', { class: 'text-xs text-muted- font-mono' }, '[Rep name]'),
          el('input', {
            class: 'flex-1 rounded-lg border px-3 py-2 text-sm',
            value: s.first_blood.message,
            oninput: (e) => { s.first_blood.message = e.target.value; persist(); },
          }),
        ),
      ),
      el('label', { class: 'block text-sm' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, 'Image URL'),
        el('input', {
          class: 'w-full rounded-lg border px-3 py-2 text-sm',
          value: s.first_blood.image_url,
          oninput: (e) => { s.first_blood.image_url = e.target.value; persist(); },
        }),
        el('p', { class: 'text-[10px] text-muted- mt-1' }, 'Paste any direct image URL (Imgur, etc.)'),
      ),
    ),

    // ── Daily Update ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center gap-2 mb-1' },
        el('span', { class: 'text-base' }, '📊'),
        el('h3', { class: 'text-sm font-bold' }, 'Daily Update DM'),
      ),
      el('p', { class: 'text-xs text-muted- mb-3' },
        "DM'd to each rep with their daily, weekly, monthly, and yearly totals."),
      el('label', { class: 'flex items-center gap-2 mb-3 text-sm' },
        el('input', {
          type: 'checkbox',
          class: 'accent-lime w-4 h-4',
          checked: s.daily_update.enabled,
          onchange: (e) => { s.daily_update.enabled = e.target.checked; persist(); },
        }),
        'Enable daily update DMs',
      ),
      el('div', { class: 'grid grid-cols-2 gap-3 mb-3' },
        el('label', { class: 'block text-sm' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, 'Send Time'),
          el('input', {
            type: 'time',
            class: 'w-full rounded-lg border px-3 py-2 text-sm',
            value: s.daily_update.send_time,
            onchange: (e) => { s.daily_update.send_time = e.target.value; persist(); },
          }),
        ),
      ),
      el('div', { class: 'flex flex-col gap-1.5' },
        ...[['include_week', 'Include running week total'], ['include_month', 'Include running month total'], ['include_year', 'Include running year total']].map(([k, label]) =>
          el('label', { class: 'flex items-center gap-2 text-sm' },
            el('input', {
              type: 'checkbox',
              class: 'accent-lime w-4 h-4',
              checked: s.daily_update[k],
              onchange: (e) => { s.daily_update[k] = e.target.checked; persist(); },
            }),
            label,
          )
        ),
      ),
      el('button', {
        class: 'mt-4 px-4 py-2 rounded-lg text-sm font-semibold border',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        onclick: () => toast('Sample DM sent to all reps (demo)', 'success'),
      }, 'Send Test to All Reps'),
    ),

    // ── Pay Stub DMs ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center gap-2 mb-1' },
        el('span', { class: 'text-base' }, '💰'),
        el('h3', { class: 'text-sm font-bold' }, 'Pay Stub DMs'),
      ),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'Send the current pay period stub to an individual rep as a DM.'),
      el('div', { class: 'flex gap-2' },
        el('select', {
          id: 'paystub-rep-picker',
          class: 'flex-1 rounded-lg border px-3 py-2 text-sm',
        },
          el('option', { value: '' }, 'Select a rep...'),
          ...profiles.map(p => el('option', { value: p.id }, p.full_name)),
        ),
        el('button', {
          class: 'px-4 py-2 rounded-lg text-sm font-semibold',
          style: { background: 'var(--accent)', color: 'var(--accent-text)' },
          onclick: () => {
            const sel = document.getElementById('paystub-rep-picker');
            if (!sel.value) return toast('Pick a rep first', 'warn');
            const rep = profiles.find(p => p.id === sel.value);
            toast('Pay stub DM sent to ' + rep.full_name + ' (demo)', 'success');
          },
        }, 'Send Pay Stub'),
      ),
    ),

    // ── Sale Broadcast ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center gap-2 mb-1' },
        el('span', { class: 'text-base' }, '📢'),
        el('h3', { class: 'text-sm font-bold' }, 'Sale Broadcast'),
      ),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'Every time a sale is logged, auto-post to a channel with the rep\'s avatar, customer name, service type, and ACV.'),
      el('label', { class: 'flex items-center gap-2 mb-3 text-sm' },
        el('input', {
          type: 'checkbox', class: 'accent-lime w-4 h-4',
          checked: s.sale_broadcast?.enabled || false,
          onchange: (e) => { if (!s.sale_broadcast) s.sale_broadcast = {}; s.sale_broadcast.enabled = e.target.checked; persist(); },
        }),
        'Enable sale broadcast',
      ),
      el('label', { class: 'block text-sm' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, 'Channel'),
        el('select', {
          class: 'w-full rounded-lg border px-3 py-2 text-sm',
          onchange: (e) => { if (!s.sale_broadcast) s.sale_broadcast = {}; s.sale_broadcast.channel = e.target.value; persist(); },
        },
          el('option', { value: '' }, 'Select channel...'),
          ...s.slack_channels.map(ch => el('option', { value: ch.name, selected: s.sale_broadcast?.channel === ch.name }, ch.name)),
        ),
      ),
    ),

    // ── Weekly Digest ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center gap-2 mb-1' },
        el('span', { class: 'text-base' }, '📋'),
        el('h3', { class: 'text-sm font-bold' }, 'Weekly Digest'),
      ),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'End-of-week summary posted to a channel: leaderboard snapshot, top earners, badges earned, records broken.'),
      el('label', { class: 'flex items-center gap-2 mb-3 text-sm' },
        el('input', {
          type: 'checkbox', class: 'accent-lime w-4 h-4',
          checked: s.weekly_digest?.enabled || false,
          onchange: (e) => { if (!s.weekly_digest) s.weekly_digest = {}; s.weekly_digest.enabled = e.target.checked; persist(); },
        }),
        'Enable weekly digest',
      ),
      el('div', { class: 'grid grid-cols-2 gap-3' },
        el('label', { class: 'block text-sm' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, 'Day'),
          el('select', {
            class: 'w-full rounded-lg border px-3 py-2 text-sm',
            onchange: (e) => { if (!s.weekly_digest) s.weekly_digest = {}; s.weekly_digest.day = e.target.value; persist(); },
          },
            ...['Friday', 'Saturday', 'Sunday', 'Monday'].map(d =>
              el('option', { value: d, selected: (s.weekly_digest?.day || 'Friday') === d }, d)),
          ),
        ),
        el('label', { class: 'block text-sm' },
          el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, 'Time'),
          el('input', {
            type: 'time', class: 'w-full rounded-lg border px-3 py-2 text-sm',
            value: s.weekly_digest?.time || '17:00',
            onchange: (e) => { if (!s.weekly_digest) s.weekly_digest = {}; s.weekly_digest.time = e.target.value; persist(); },
          }),
        ),
      ),
    ),

    // ── Competition Updates ──
    el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-center gap-2 mb-1' },
        el('span', { class: 'text-base' }, '🏅'),
        el('h3', { class: 'text-sm font-bold' }, 'Competition Updates'),
      ),
      el('p', { class: 'text-xs text-muted- mb-3' }, 'Auto-post to a channel when a rep completes a bingo square or hits a competition milestone.'),
      el('label', { class: 'flex items-center gap-2 mb-3 text-sm' },
        el('input', {
          type: 'checkbox', class: 'accent-lime w-4 h-4',
          checked: s.comp_updates?.enabled || false,
          onchange: (e) => { if (!s.comp_updates) s.comp_updates = {}; s.comp_updates.enabled = e.target.checked; persist(); },
        }),
        'Enable competition updates',
      ),
      el('label', { class: 'block text-sm' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1 font-semibold' }, 'Channel'),
        el('select', {
          class: 'w-full rounded-lg border px-3 py-2 text-sm',
          onchange: (e) => { if (!s.comp_updates) s.comp_updates = {}; s.comp_updates.channel = e.target.value; persist(); },
        },
          el('option', { value: '' }, 'Select channel...'),
          ...s.slack_channels.map(ch => el('option', { value: ch.name, selected: s.comp_updates?.channel === ch.name }, ch.name)),
        ),
      ),
    ),

    // ── Rep Slack User IDs ──
    el('div', { class: 'card p-5' },
      el('h3', { class: 'text-sm font-bold mb-1' }, 'Rep Slack User IDs'),
      el('p', { class: 'text-xs text-muted- mb-3' },
        'Find a rep\'s Slack User ID: click their profile → ⋮ → Copy member ID. Looks like ',
        el('code', { style: { color: 'var(--accent)' } }, 'U01AB2CD3EF'),
        '.',
      ),
      el('div', { class: 'flex flex-col gap-2' },
        ...profiles.map(p => el('div', { class: 'flex items-center gap-3' },
          el('div', { class: 'flex items-center gap-2 w-44 shrink-0' },
            avatarNode(p.avatar_url, p.initials, 'w-6 h-6 text-[8px]'),
            el('span', { class: 'text-sm font-medium truncate' }, p.full_name),
          ),
          el('input', {
            class: 'flex-1 rounded-lg border px-3 py-2 text-sm font-mono',
            placeholder: 'U01AB2CD3EF',
            value: p.slack_user_id || '',
            oninput: (e) => { p.slack_user_id = e.target.value; persist(); },
          }),
        )),
      ),
    ),
  );
}

async function auditSale(saleId, status, auditNote = '') {
  if (DEMO) {
    // Update both collections since admins audit sales from other reps too
    for (const list of [state.mySales, state.allSales]) {
      const sale = list.find(s => s.id === saleId);
      if (sale) {
        sale.audit_status = status;
        sale.audited_by = state.profile.id;
        sale.audited_at = new Date().toISOString();
        sale.audit_note = auditNote || null;
        sale.audit_note_by = auditNote ? state.profile.full_name : null;
      }
    }
    const sale = state.allSales.find(s => s.id === saleId);
    logActivity('audit', { sale_id: saleId, customer_name: sale?.customer_name, old_status: sale?.audit_status, new_status: status });
    toast('Sale ' + status.replace('_', ' '), 'success');
    saveDemoData();
    mountApp();
    return;
  }
  try {
    const updatePayload = {
      audit_status: status,
      audited_by: state.profile.id,
      audited_at: new Date().toISOString(),
    };
    if (auditNote) { updatePayload.audit_note = auditNote; updatePayload.audit_note_by = state.profile.full_name; }
    const { error } = await supabase.from('sales').update(updatePayload).eq('id', saleId);
    if (error) throw error;
    toast('Sale ' + status.replace('_', ' '), 'success');
    await loadData();
    await recomputeAllProgress();
    mountApp();
  } catch (err) {
    toast(err.message || 'Failed', 'error');
  }
}

function adminCompetitions() {
  const host = el('div', { class: 'flex flex-col gap-4' });
  host.append(
    el('button', {
      class: 'self-start px-4 py-2 rounded-xl bg-lime text-eerie font-semibold',
      onclick: () => openCompEditor(),
    }, '+ New competition'),
  );
  if (state.competitions.length === 0) {
    host.append(el('div', { class: 'card p-6 text-center text-battle-2 text-sm' }, 'No competitions yet.'));
  } else {
    state.competitions.forEach(c => host.append(
      el('div', { class: 'card p-4 flex items-center justify-between gap-3' },
        el('div', { class: 'flex-1' },
          el('div', { class: 'font-semibold' }, c.name),
          el('div', { class: 'text-xs text-battle-2' },
            `${c.category.replace('_', ' ')} · ${c.type} · ${fmt.dateShort(c.start_date)} → ${fmt.dateShort(c.end_date)} · ${state.compRules.filter(r => r.competition_id === c.id).length} rules`),
        ),
        el('div', { class: 'flex gap-2' },
          el('button', {
            class: 'text-xs px-3 py-1.5 rounded-lg border border-battleship text-battle-2 hover:border-lime hover:text-lime',
            onclick: () => openCompEditor(c),
          }, 'Edit'),
          el('button', {
            class: 'text-xs px-3 py-1.5 rounded-lg border border- text-muted- hover:border-red-500 hover:text-red-400 transition',
            onclick: async () => {
              if (!confirm('Delete "' + c.name + '" and all its rules?')) return;
              if (DEMO) {
                state.competitions = state.competitions.filter(x => x.id !== c.id);
                state.compRules    = state.compRules.filter(r => r.competition_id !== c.id);
                state.compProgress = state.compProgress.filter(p => p.competition_id !== c.id);
                toast('Deleted (demo)', 'success');
      saveDemoData();
                mountApp();
                return;
              }
              const { error } = await supabase.from('competitions').delete().eq('id', c.id);
              if (error) return toast(error.message, 'error');
              toast('Deleted', 'success');
              await loadData();
              mountApp();
            },
          }, 'Delete'),
        ),
      ),
    ));
  }
  return host;
}

function openCompEditor(existing = null) {
  const overlay = el('div', { class: 'fixed inset-0 bg-black/70 z-40 flex items-start justify-center p-4 overflow-y-auto' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  const form = el('form', {
    class: 'card p-6 w-full max-w-2xl my-8 flex flex-col gap-4',
    onsubmit: async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      const payload = {
        name: data.name,
        category: data.category,
        type: data.type,
        start_date: data.start_date,
        end_date: data.end_date,
        prize_text: data.prize_text || null,
        description: data.description || null,
        min_qualifying_revenue: data.min_qualifying_revenue ? parseFloat(data.min_qualifying_revenue) : null,
        is_active: true,
      };
      try {
        const rulesList = ruleRows.map(r => r.getData()).filter(r => r.label && r.metric);

        if (DEMO) {
          let compId;
          if (existing) {
            compId = existing.id;
            Object.assign(existing, payload);
            state.compRules = state.compRules.filter(r => r.competition_id !== compId);
          } else {
            compId = Math.max(0, ...state.competitions.map(c => c.id)) + 1;
            state.competitions.push({ ...payload, id: compId, created_by: state.profile.id });
          }
          const nextRuleId = Math.max(0, ...state.compRules.map(r => r.id)) + 1;
          rulesList.forEach((r, i) => state.compRules.push({ ...r, id: nextRuleId + i, competition_id: compId }));
          // Recompute progress locally for the demo rep
          state.compProgress = state.compProgress.filter(p => p.competition_id !== compId);
          const comp = state.competitions.find(c => c.id === compId);
          for (const rule of state.compRules.filter(r => r.competition_id === compId)) {
            const val = evaluateRule(rule, comp, state.mySales);
            state.compProgress.push({
              id: state.compProgress.length + 1,
              competition_id: compId, rule_id: rule.id, rep_id: state.profile.id,
              current_value: val, met: compare(val, rule.operator, Number(rule.threshold)),
              last_computed_at: new Date().toISOString(),
            });
          }
          toast('Saved (demo)', 'success');
      saveDemoData();
          overlay.remove();
          mountApp();
          return;
        }

        let compId;
        if (existing) {
          const { error } = await supabase.from('competitions').update(payload).eq('id', existing.id);
          if (error) throw error;
          compId = existing.id;
        } else {
          payload.created_by = state.profile.id;
          const { data: inserted, error } = await supabase.from('competitions').insert(payload).select().single();
          if (error) throw error;
          compId = inserted.id;
        }
        // save rules
        if (existing) {
          await supabase.from('competition_rules').delete().eq('competition_id', compId);
        }
        if (rulesList.length) {
          const { error: rulesErr } = await supabase.from('competition_rules').insert(
            rulesList.map(r => ({ ...r, competition_id: compId })),
          );
          if (rulesErr) throw rulesErr;
        }
        toast('Competition saved', 'success');
        await loadData();
        await recomputeAllProgress();
        overlay.remove();
        mountApp();
      } catch (err) {
        toast(err.message || 'Save failed', 'error');
      }
    },
  });

  const inp = (name, attrs = {}) => el('input', { name, class: 'w-full rounded-lg border px-3 py-2 text-sm', ...attrs });
  const mk = (label, input) => el('label', { class: 'block text-sm' },
    el('span', { class: 'text-battle-2 block mb-1 text-xs' }, label), input);

  form.append(
    el('h2', { class: 'text-xl font-bold' }, existing ? 'Edit competition' : 'New competition'),
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-3' },
      mk('Name', inp('name', { required: true, value: existing?.name || '' })),
      mk('Category', el('select', { name: 'category', class: 'w-full rounded-lg border px-3 py-2 text-sm' },
        el('option', { value: 'inside_sales', selected: existing?.category === 'inside_sales' }, 'Inside Sales'),
        el('option', { value: 'loyalty', selected: existing?.category === 'loyalty' }, 'Loyalty'),
      )),
      mk('Type', el('select', { name: 'type', class: 'w-full rounded-lg border px-3 py-2 text-sm' },
        el('option', { value: 'bingo', selected: existing?.type === 'bingo' }, 'Bingo'),
        el('option', { value: 'royalty', selected: existing?.type === 'royalty' }, 'Royalty'),
      )),
      mk('Prize text', inp('prize_text', { placeholder: '$300/mo · 150,000 RC · etc.', value: existing?.prize_text || '' })),
      mk('Start date', inp('start_date', { type: 'date', required: true, value: existing?.start_date || new Date().toISOString().slice(0, 10) })),
      mk('End date', inp('end_date', { type: 'date', required: true, value: existing?.end_date || '' })),
      mk('Min qualifying revenue (royalty only)', inp('min_qualifying_revenue', { type: 'number', step: '0.01', value: existing?.min_qualifying_revenue || '' })),
    ),
    mk('Description', el('textarea', { name: 'description', rows: 2, class: 'w-full rounded-lg border px-3 py-2 text-sm' }, existing?.description || '')),
  );

  // Rules editor
  const rulesHost = el('div', { class: 'flex flex-col gap-2' });
  const ruleRows = [];

  function addRuleRow(r = {}) {
    const row = el('div', { class: 'grid grid-cols-[1fr_auto_auto_auto_auto_auto_auto] sm:grid-cols-[1.5fr_1fr_.8fr_.6fr_.7fr_.5fr_.5fr_auto] gap-2 items-center' });
    const label    = inp('label',     { placeholder: 'Label', value: r.label || '' });
    const metric   = el('select', { class: 'rounded-lg border px-2 py-2 text-xs' },
      ...['count','sum_revenue','sum_initial','sum_monthly','avg_initial','close_rate'].map(m =>
        el('option', { value: m, selected: r.metric === m }, metricLabel(m))));
    const windw    = el('select', { class: 'rounded-lg border px-2 py-2 text-xs' },
      ...['day','week','month','competition'].map(w =>
        el('option', { value: w, selected: r.window === w }, w)));
    const opSel    = el('select', { class: 'rounded-lg border px-2 py-2 text-xs' },
      ...['>','>=','<','<=','=','!='].map(op =>
        el('option', { value: op, selected: r.operator === op }, op)));
    const thresh   = inp('threshold', { type: 'number', step: '0.01', value: r.threshold ?? '', placeholder: 'n' });
    const brow     = inp('bingo_row', { type: 'number', min: 0, value: r.bingo_row ?? '', placeholder: 'r', class: 'w-12 rounded-lg border px-2 py-2 text-xs text-center' });
    const bcol     = inp('bingo_col', { type: 'number', min: 0, value: r.bingo_col ?? '', placeholder: 'c', class: 'w-12 rounded-lg border px-2 py-2 text-xs text-center' });
    const del      = el('button', { type: 'button', class: 'text-battle-2 hover:text-red-400 text-lg', onclick: () => { row.remove(); ruleRows.splice(ruleRows.indexOf(rowApi), 1); } }, '×');

    row.append(label, metric, windw, opSel, thresh, brow, bcol, del);
    const rowApi = {
      el: row,
      getData: () => ({
        label: label.value,
        metric: metric.value,
        window: windw.value,
        operator: opSel.value,
        threshold: parseFloat(thresh.value) || 0,
        bingo_row: brow.value === '' ? null : parseInt(brow.value),
        bingo_col: bcol.value === '' ? null : parseInt(bcol.value),
        filters: {},
      }),
    };
    ruleRows.push(rowApi);
    rulesHost.append(row);
  }

  const existingRules = existing ? state.compRules.filter(r => r.competition_id === existing.id) : [];
  if (existingRules.length) existingRules.forEach(addRuleRow);
  else addRuleRow();

  form.append(
    el('div', {},
      el('div', { class: 'flex items-center justify-between mb-2' },
        el('h3', { class: 'text-sm font-semibold' }, 'Rules / Bingo squares'),
        el('button', { type: 'button', class: 'text-xs text-lime hover:text-lime-400', onclick: () => addRuleRow() }, '+ Add rule'),
      ),
      el('div', { class: 'grid grid-cols-[1.5fr_1fr_.8fr_.6fr_.7fr_.5fr_.5fr_auto] gap-2 text-[10px] text-battleship uppercase tracking-widest mb-1' },
        el('div', {}, 'Label'),
        el('div', {}, 'Metric'),
        el('div', {}, 'Window'),
        el('div', {}, 'Op'),
        el('div', {}, 'Thresh'),
        el('div', { class: 'text-center' }, 'R'),
        el('div', { class: 'text-center' }, 'C'),
        el('div', {}),
      ),
      rulesHost,
      el('p', { class: 'text-[10px] text-battleship mt-2' }, 'Bingo R/C = row/col position on bingo card. Leave blank for list-style rules.'),
    ),
  );

  form.append(
    el('div', { class: 'flex justify-end gap-2 pt-2 border-t border-eerie3' },
      el('button', { type: 'button', class: 'px-4 py-2 rounded-lg text-battle-2 hover:text-smoke', onclick: () => overlay.remove() }, 'Cancel'),
      el('button', { type: 'submit', class: 'px-4 py-2 rounded-lg bg-lime text-eerie font-semibold' }, 'Save'),
    ),
  );

  overlay.append(form);
  document.body.append(overlay);
}

function adminReps() {
  const host = el('div', { class: 'flex flex-col gap-4' });

  host.append(
    el('div', { class: 'flex items-center justify-between flex-wrap gap-3' },
      el('div', {},
        el('h3', { class: 'text-lg font-bold' }, 'Users'),
        el('p', { class: 'text-xs text-muted-' }, 'Add reps, manage their profile, assign avatars.'),
      ),
      el('button', {
        class: 'px-4 py-2 rounded-xl font-semibold text-sm transition hover:brightness-95',
        style: { background: 'var(--accent)', color: 'var(--accent-text)' },
        onclick: () => openUserEditor(),
      }, '+ New user'),
    ),
  );

  const profiles = state.allProfiles.length ? state.allProfiles : [state.profile];

  host.append(
    el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'scroll-x' },
        el('table', { class: 'w-full text-sm' },
          el('thead', { class: 'text-[10px] uppercase tracking-widest text-muted-' },
            el('tr', {},
              el('th', { class: 'text-left px-4 py-3' }, 'User'),
              el('th', { class: 'text-left px-3 py-3' }, 'Email'),
              el('th', { class: 'text-left px-3 py-3' }, 'Role'),
              el('th', { class: 'text-right px-3 py-3' }, 'Annual Goal'),
              el('th', { class: 'text-center px-3 py-3' }, 'Status'),
              el('th', { class: 'text-right px-3 py-3' }, ''),
            ),
          ),
          el('tbody', {},
            profiles.map(p => {
              const active = p.is_active !== false;
              return el('tr', { class: 'border-t border-' + (!active ? ' opacity-50' : '') },
                el('td', { class: 'px-4 py-3' },
                  el('div', { class: 'flex items-center gap-3' },
                    avatarNode(p.avatar_url, p.initials, 'w-9 h-9 text-[10px]'),
                    el('div', { class: 'font-semibold' }, p.full_name),
                  ),
                ),
                el('td', { class: 'px-3 py-3 text-muted-' }, p.email || '—'),
                el('td', { class: 'px-3 py-3 capitalize' }, p.role),
                el('td', { class: 'px-3 py-3 text-right tabular-nums' }, fmt.usd0(p.annual_revenue_goal || 0)),
                el('td', { class: 'px-3 py-3 text-center' },
                  el('span', {
                    class: 'chip',
                    style: active
                      ? { background: 'rgba(141,198,63,.14)', color: '#5F8A1F', border: '1px solid rgba(141,198,63,.4)' }
                      : { background: 'rgba(220,38,38,.08)', color: '#B91C1C', border: '1px solid rgba(220,38,38,.25)' },
                  }, active ? 'Active' : 'Inactive'),
                ),
                el('td', { class: 'px-3 py-3 text-right' },
                  el('button', {
                    class: 'text-xs px-3 py-1.5 rounded-lg border border- text-muted- hover:text-default transition',
                    onclick: () => openUserEditor(p),
                  }, 'Edit'),
                ),
              );
            }),
          ),
        ),
      ),
    ),
  );

  return host;
}

// ──────────────────────────────────────────────────────────────────────────
// USER EDITOR MODAL (admin)
// ──────────────────────────────────────────────────────────────────────────
function openUserEditor(existing = null) {
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

  // Modal-local state so we can track avatar changes + active toggle
  const modal = {
    avatar_url: existing?.avatar_url || '',
    is_active: existing ? (existing.is_active !== false) : true,
  };

  const form = el('form', {
    class: 'card w-full max-w-xl my-8 flex flex-col',
    style: { maxHeight: 'calc(100vh - 64px)' },
    onsubmit: async e => {
      e.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      // Commission: standard base rate is 7%. The "Commission Override" field
      // is a BUMP added on top of the base (e.g. 0.5 means 7.5% total).
      const BASE_COMMISSION = 0.07;
      const bumpRaw = data.commission_override?.trim();
      const bumpPct = bumpRaw === '' || bumpRaw == null ? 0 : parseFloat(bumpRaw);
      const totalRate = BASE_COMMISSION + (bumpPct / 100);
      const payload = {
        full_name: data.full_name,
        email: data.email,
        role: data.role,
        initials: data.initials || null,
        avatar_url: modal.avatar_url || null,
        annual_revenue_goal: parseFloat(data.annual_revenue_goal) || 250000,
        is_active: modal.is_active,
        // Round to 4 decimal places to avoid float noise (0.07+0.005=0.074999...)
        upfront_commission_rate: Math.round(totalRate * 10000) / 10000,
        close_rate_target: data.close_rate_target
          ? parseFloat(data.close_rate_target) / 100
          : (existing?.close_rate_target ?? 0.60),
      };

      if (DEMO) {
        if (existing) {
          Object.assign(existing, payload);
          if (existing.id === state.profile.id) Object.assign(state.profile, payload);
        } else {
          const newId = 'demo-' + (state.allProfiles.length + 1);
          state.allProfiles.push({ id: newId, ...payload });
        }
        toast('Saved', 'success');
        saveDemoData();
        overlay.remove();
        mountApp();
        return;
      }

      try {
        if (existing) {
          const { error } = await supabase.from('profiles').update(payload).eq('id', existing.id);
          if (error) throw error;
        } else {
          // 1) Stash the invite payload so handle_new_user() can merge it into
          //    the profile when the rep clicks the magic link and signs in.
          //    pending_invites only stores the fields handle_new_user copies —
          //    commission_rate / close_rate_target / is_active live on profiles
          //    and the admin can edit them after the rep first signs in.
          const invitePayload = {
            email: payload.email,
            full_name: payload.full_name,
            role: payload.role,
            initials: payload.initials,
            avatar_url: payload.avatar_url,
            annual_revenue_goal: payload.annual_revenue_goal,
            created_by: state.profile.id,
          };
          const { error: insertErr } = await supabase
            .from('pending_invites')
            .upsert(invitePayload, { onConflict: 'email' });
          if (insertErr) throw insertErr;
          // 2) Email a magic link that creates the auth user on first click.
          //    `shouldCreateUser: true` is the default, but we set it explicitly
          //    so this stays correct if Supabase ever flips the default.
          const { error: otpErr } = await supabase.auth.signInWithOtp({
            email: payload.email,
            options: {
              shouldCreateUser: true,
              emailRedirectTo: window.location.origin,
              data: { full_name: payload.full_name },
            },
          });
          if (otpErr) {
            // Roll back the pending invite so a retry doesn't double-up.
            await supabase.from('pending_invites').delete().eq('email', payload.email);
            throw otpErr;
          }
          toast('Invite emailed to ' + payload.email, 'success');
        }
        await loadData();
        overlay.remove();
        mountApp();
      } catch (err) {
        toast(err.message || 'Save failed', 'error');
      }
    },
  });

  const inp = (name, attrs = {}) => el('input', { name, class: 'w-full rounded-lg border px-3 py-2 text-sm', ...attrs });
  const mk = (label, input) => el('label', { class: 'block text-sm' },
    el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' }, label),
    input,
  );

  // ── Avatar upload (click-to-upload) ──
  const hiddenFile = el('input', {
    type: 'file',
    accept: 'image/jpeg,image/png,image/gif,image/webp',
    style: { display: 'none' },
    onchange: (e) => {
      const file = e.target.files[0];
      if (!file) return;
      // Compress to a small 128×128 JPEG thumbnail so it fits in localStorage
      // (raw data URLs can be 1-2MB each, blowing the 5MB localStorage cap).
      const img = new Image();
      img.onload = () => {
        const SIZE = 80;  // small thumbnail — keeps localStorage usage low
        const canvas = document.createElement('canvas');
        canvas.width = SIZE;
        canvas.height = SIZE;
        const ctx = canvas.getContext('2d');
        // Center-crop to square
        const min = Math.min(img.width, img.height);
        const sx = (img.width - min) / 2;
        const sy = (img.height - min) / 2;
        ctx.drawImage(img, sx, sy, min, min, 0, 0, SIZE, SIZE);
        modal.avatar_url = canvas.toDataURL('image/jpeg', 0.6); // ~3-8KB per avatar
        renderAvatar();
        URL.revokeObjectURL(img.src);
      };
      img.src = URL.createObjectURL(file);
    },
  });

  const avatarDisplay = el('div', { class: 'relative cursor-pointer', onclick: () => hiddenFile.click() });
  function renderAvatar() {
    avatarDisplay.innerHTML = '';
    avatarDisplay.append(
      avatarNode(modal.avatar_url, existing?.initials || '??', 'w-20 h-20 text-base'),
      el('div', {
        class: 'absolute rounded-full flex items-center justify-center',
        style: {
          bottom: '0', right: '0',
          width: '26px', height: '26px',
          background: '#1D1D1D', border: '2px solid var(--card)',
        },
      }, el('span', { style: { color: '#F3F3F3', fontSize: '12px' } }, '📷')),
      hiddenFile,
    );
  }
  renderAvatar();

  // ── Active/Deactivate pill ──
  const activeToggle = el('button', {
    type: 'button',
    class: 'flex items-center gap-1.5 text-xs font-semibold transition',
    onclick: () => { modal.is_active = !modal.is_active; renderActiveToggle(); },
  });
  function renderActiveToggle() {
    activeToggle.innerHTML = '';
    if (modal.is_active) {
      activeToggle.style.color = 'var(--accent)';
      activeToggle.append(
        el('span', { style: { color: 'var(--accent)' } }, '☑'),
        el('span', {}, 'Active '),
        el('span', { class: 'font-normal text-muted-' }, '(click to deactivate)'),
      );
    } else {
      activeToggle.style.color = '#DC2626';
      activeToggle.append(
        el('span', { style: { color: '#DC2626' } }, '☒'),
        el('span', {}, 'Inactive '),
        el('span', { class: 'font-normal text-muted-' }, '(click to activate)'),
      );
    }
  }
  renderActiveToggle();

  // ── Header ──
  const header = el('div', { class: 'px-6 pt-6 pb-4' },
    el('div', { class: 'flex items-center justify-between mb-4' },
      el('h2', { class: 'text-xl font-bold' }, existing ? 'Edit User' : 'New User'),
      el('button', { type: 'button', class: 'text-2xl text-muted-', onclick: () => overlay.remove() }, '×'),
    ),
    el('button', {
      type: 'button',
      class: 'text-xs text-muted- hover:text-default transition',
      onclick: () => overlay.remove(),
    }, '← Back to Users'),
  );

  // ── Avatar section ──
  const avatarSection = el('div', { class: 'px-6 pb-4 flex items-center gap-4' },
    avatarDisplay,
    el('div', { class: 'flex-1' },
      el('div', { class: 'text-sm font-medium' }, 'Click avatar to upload photo'),
      el('div', { class: 'text-[11px] text-muted- mt-0.5' }, 'JPG, PNG, GIF supported'),
    ),
  );

  // ── Form body ──
  const body = el('div', { class: 'px-6 pb-4 overflow-y-auto flex-1 flex flex-col gap-4' },
    mk('Full Name', inp('full_name', { required: true, value: existing?.full_name || '' })),
    mk('Email', inp('email', { type: 'email', required: true, value: existing?.email || '' })),
    el('label', { class: 'block text-sm' },
      el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' },
        'Password ',
        el('span', { class: 'normal-case text-muted- font-normal tracking-normal text-[10px]' }, '— leave blank to keep existing'),
      ),
      inp('password', { type: 'password', placeholder: 'Leave blank to keep current', autocomplete: 'new-password' }),
    ),
    mk('User Role', el('select', { name: 'role', class: 'w-full rounded-lg border px-3 py-2 text-sm' },
      el('option', { value: 'rep',       selected: (existing?.role || 'rep') === 'rep' },     'Rep'),
      el('option', { value: 'admin_rep', selected: existing?.role === 'admin_rep' },          'Admin + Sales'),
      el('option', { value: 'admin',     selected: existing?.role === 'admin' },              'Admin (no sales)'),
      el('option', { value: 'auditor',   selected: existing?.role === 'auditor' },            'Auditor'),
    )),
    el('div', { class: 'grid grid-cols-2 gap-3' },
      el('label', { class: 'block text-sm' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' },
          'Commission Bump ',
          el('span', { class: 'normal-case text-muted- font-normal tracking-normal text-[10px]' }, '— above 7% base'),
        ),
        el('div', { class: 'relative' },
          (() => {
            // Bump = (rate - base) * 100, rounded to 1 decimal to kill floating point noise
            const BASE = 0.07;
            const currentBump = existing?.upfront_commission_rate
              ? Math.round(((existing.upfront_commission_rate - BASE) * 100) * 10) / 10
              : '';
            return inp('commission_override', {
              type: 'number', step: '0.5', min: 0, max: 20,
              placeholder: 'e.g. 0.5',
              value: currentBump === 0 ? '' : currentBump,
              class: 'w-full rounded-lg border pl-3 pr-8 py-2 text-sm',
            });
          })(),
          el('span', { class: 'absolute right-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '%'),
        ),
        el('div', { class: 'text-[10px] text-muted- mt-1' }, 'Blank = 7% standard · 0.5 bump = 7.5% total'),
      ),
      el('label', { class: 'block text-sm' },
        el('span', { class: 'text-[10px] uppercase tracking-widest text-muted- block mb-1.5 font-semibold' },
          'Close Rate ',
          el('span', { class: 'normal-case text-muted- font-normal tracking-normal text-[10px]' }, '— backend bonus'),
        ),
        el('div', { class: 'relative' },
          inp('close_rate_target', {
            type: 'number', step: '1', min: 0, max: 100,
            placeholder: 'e.g. 62',
            value: existing?.close_rate_target ? Math.round(existing.close_rate_target * 100) : '',
            class: 'w-full rounded-lg border pl-3 pr-8 py-2 text-sm',
          }),
          el('span', { class: 'absolute right-3 top-1/2 -translate-y-1/2 text-muted- text-sm' }, '%'),
        ),
      ),
    ),
    mk('Initials', inp('initials', { maxlength: 4, value: existing?.initials || '' })),
    mk('Annual Revenue Goal ($)', inp('annual_revenue_goal', { type: 'number', min: 0, step: 1000, value: existing?.annual_revenue_goal || 250000 })),
  );

  // ── Footer with Save, Cancel, Active toggle ──
  const removeBtn = (existing && existing.id !== state.profile.id) ? el('button', {
    type: 'button',
    class: 'px-4 py-2 rounded-lg text-xs font-semibold border hover:border-red-500 hover:text-red-500 transition',
    style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
    onclick: () => {
      if (!confirm('Remove ' + existing.full_name + '?')) return;
      if (DEMO) {
        state.allProfiles = state.allProfiles.filter(x => x.id !== existing.id);
        toast('Removed', 'success');
        saveDemoData();
        overlay.remove();
        mountApp();
        return;
      }
      toast('Users with active auth accounts must be removed via Supabase Auth.', 'warn');
    },
  }, 'Remove User') : null;

  const footer = el('div', { class: 'px-6 py-4 border-t flex items-center justify-between flex-wrap gap-3', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'flex gap-2' },
      el('button', { type: 'submit', class: 'px-5 py-2 rounded-lg font-semibold text-sm', style: { background: '#1D1D1D', color: '#F3F3F3' } }, 'Save'),
      el('button', { type: 'button', class: 'px-5 py-2 rounded-lg font-semibold text-sm border', style: { borderColor: 'var(--border-2)', color: 'var(--text)' }, onclick: () => overlay.remove() }, 'Cancel'),
    ),
    el('div', { class: 'flex items-center gap-3' },
      activeToggle,
      removeBtn,
    ),
  );

  form.append(header, avatarSection, body, footer);
  overlay.append(form);
  document.body.append(overlay);
}

// ──────────────────────────────────────────────────────────────────────────
// BINGO / RULE ENGINE
// Evaluates rules against sales data and writes results back to
// competition_progress. Runs after any audit action.
// ──────────────────────────────────────────────────────────────────────────
async function recomputeAllProgress() {
  if (DEMO) return;
  if (!state.competitions.length || !state.compRules.length) return;
  try {
    // Need EVERY rep's sales for full leaderboard eval, not just mine.
    // If I'm not an admin I can only see my own, so I only compute my own progress.
    const scope = isAdminRole(state.profile.role) ? state.allSales : state.mySales;
    const salesByRep = groupBy(scope, s => s.rep_id);
    const repIds = Object.keys(salesByRep);
    if (!isAdminRole(state.profile.role) && !repIds.includes(state.profile.id)) repIds.push(state.profile.id);

    const rows = [];
    for (const comp of state.competitions) {
      const rules = state.compRules.filter(r => r.competition_id === comp.id);
      if (!rules.length) continue;
      for (const repId of repIds) {
        const repSales = salesByRep[repId] || [];
        for (const rule of rules) {
          const val = evaluateRule(rule, comp, repSales);
          const met = compare(val, rule.operator, Number(rule.threshold));
          rows.push({
            competition_id: comp.id,
            rule_id: rule.id,
            rep_id: repId,
            current_value: val,
            met,
            last_computed_at: new Date().toISOString(),
          });
        }
      }
    }
    if (!rows.length) return;
    const { error } = await supabase.from('competition_progress').upsert(rows, { onConflict: 'rule_id,rep_id' });
    if (error) console.warn('progress upsert', error);
    // refresh cached
    const { data: refreshed } = await supabase.from('competition_progress').select('*');
    state.compProgress = refreshed || [];
  } catch (err) {
    console.warn('recomputeAllProgress', err);
  }
}

function evaluateRule(rule, comp, sales) {
  // filter sales to the rule window
  const now = new Date();
  const startWin = windowStart(rule.window, comp);
  const endWin   = windowEnd(rule.window, comp);

  // only count approved/serviced sales toward competitions
  const eligible = sales.filter(s => {
    if (!['approved','serviced'].includes(s.audit_status)) return false;
    const d = new Date(s.sold_date + 'T00:00');
    if (d < startWin || d > endWin) return false;
    // filters
    const f = rule.filters || {};
    if (f.source_id && Array.isArray(f.source_id) && !f.source_id.includes(s.source_id)) return false;
    if (f.service_type_id && Array.isArray(f.service_type_id) && !f.service_type_id.includes(s.service_type_id)) return false;
    if (f.office_id && Array.isArray(f.office_id) && !f.office_id.includes(s.office_id)) return false;
    if (f.min_revenue && Number(s.revenue_amount) < f.min_revenue) return false;
    return true;
  });

  switch (rule.metric) {
    case 'count':        return eligible.length;
    case 'sum_revenue':  return eligible.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
    case 'sum_initial':  return eligible.reduce((a, s) => a + Number(s.initial_amount || 0), 0);
    case 'sum_monthly':  return eligible.reduce((a, s) => a + Number(s.monthly_amount || 0), 0);
    case 'avg_initial':  return eligible.length ? eligible.reduce((a, s) => a + Number(s.initial_amount || 0), 0) / eligible.length : 0;
    case 'close_rate':   return 0.6; // placeholder — needs lead data
    default: return 0;
  }
}

function windowStart(window, comp) {
  const now = new Date();
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (window) {
    case 'day':         return d;
    case 'week': { const s = new Date(d); s.setDate(s.getDate() - s.getDay()); return s; }
    case 'month':       return new Date(now.getFullYear(), now.getMonth(), 1);
    case 'competition': return new Date(comp.start_date + 'T00:00');
    default: return new Date(0);
  }
}
function windowEnd(window, comp) {
  const now = new Date();
  switch (window) {
    case 'day':         return new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
    case 'week':        return now;
    case 'month':       return now;
    case 'competition': return new Date(comp.end_date + 'T23:59');
    default: return now;
  }
}
function compare(a, op, b) {
  switch (op) {
    case '>':  return a > b;
    case '>=': return a >= b;
    case '<':  return a < b;
    case '<=': return a <= b;
    case '=':  return a === b;
    case '!=': return a !== b;
    default:   return false;
  }
}
function metricLabel(m) {
  return ({
    count: 'Count',
    sum_revenue: 'Σ Revenue',
    sum_initial: 'Σ Initial',
    sum_monthly: 'Σ Monthly',
    avg_initial: 'Avg Initial',
    close_rate: 'Close rate',
    saves_count: 'Saves',
  })[m] || m;
}
function groupBy(arr, fn) {
  return arr.reduce((acc, x) => { const k = fn(x); (acc[k] ||= []).push(x); return acc; }, {});
}

// ──────────────────────────────────────────────────────────────────────────
// KPI helpers
// ──────────────────────────────────────────────────────────────────────────
function computeMyKpis() {
  const mine = state.mySales;
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const mtd = mine.filter(s => new Date(s.sold_date + 'T00:00') >= monthStart);
  const approved = mtd.filter(s => ['approved','serviced'].includes(s.audit_status));
  const pending  = mine.filter(s => s.audit_status === 'pending');
  const below    = mine.filter(s => s.audit_status === 'below_minimums');

  const revenueMtd  = approved.reduce((a, s) => a + Number(s.revenue_amount || 0), 0);
  const repId = state.profile.id;
  const estPay      = approved.reduce((a, s) => a + Number(s.revenue_amount || 0) * getCommissionRate(repId, s), 0)
                    + below.reduce((a, s) => a + Number(s.revenue_amount || 0) * getCommissionRate(repId, s), 0);
  const closeRate   = mtd.length ? approved.length / mtd.length : 0;

  return {
    approvedCount: approved.length,
    pendingCount: pending.length,
    belowCount: below.length,
    revenueMtd, estPay, closeRate,
  };
}
function sumSales(sales, predicate) {
  const matched = sales.filter(predicate);
  return {
    count: matched.length,
    revenue: matched.reduce((a, s) => a + Number(s.revenue_amount || 0), 0),
  };
}
function isCompActive(c) {
  const now = new Date();
  return new Date(c.start_date) <= now && new Date(c.end_date + 'T23:59') >= now;
}

// ──────────────────────────────────────────────────────────────────────────
// Utility: CSV export
// ──────────────────────────────────────────────────────────────────────────
function downloadCsv(rows) {
  if (!rows.length) return toast('Nothing to export', 'warn');
  const headers = [
    'customer_name','customer_number','office','service_type','source',
    'initial','monthly','revenue','sold_date','bill_date','status','notes',
  ];
  const lines = [headers.join(',')];
  for (const s of rows) {
    lines.push([
      csvEsc(s.customer_name),
      csvEsc(s.customer_number || ''),
      csvEsc(nameFromId(state.offices, s.office_id)),
      csvEsc(nameFromId(state.serviceTypes, s.service_type_id)),
      csvEsc(nameFromId(state.sources, s.source_id)),
      s.initial_amount, s.monthly_amount, s.revenue_amount,
      s.sold_date, s.bill_date || '', s.audit_status,
      csvEsc(s.notes || ''),
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = el('a', { href: url, download: `ridd-sales-${new Date().toISOString().slice(0,10)}.csv` });
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
function csvEsc(v) {
  if (v == null) return '';
  const s = String(v);
  if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
  return s;
}

// ──────────────────────────────────────────────────────────────────────────
// Icons (inline SVG)
// ──────────────────────────────────────────────────────────────────────────
function svg(paths, size = 20) {
  const s = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${paths}</svg>`;
  const div = document.createElement('div');
  div.innerHTML = s;
  return div.firstElementChild;
}
function iconDashboard() { return svg('<rect x="3" y="3" width="7" height="9"/><rect x="14" y="3" width="7" height="5"/><rect x="14" y="12" width="7" height="9"/><rect x="3" y="16" width="7" height="5"/>'); }
function iconSales()     { return svg('<path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>'); }
function iconPay()       { return svg('<rect x="2" y="5" width="20" height="14" rx="2"/><line x1="2" y1="10" x2="22" y2="10"/>'); }
function iconTrophy()    { return svg('<path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6"/><path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20.24 7 22"/><path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20.24 17 22"/><path d="M18 2H6v7a6 6 0 0 0 12 0V2Z"/>'); }
function iconHistory()   { return svg('<path d="M3 12a9 9 0 1 0 9-9 9.74 9.74 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M12 7v5l4 2"/>'); }
function iconShield()    { return svg('<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'); }
function iconCrown()     { return svg('<path d="M2 20h20l-2-10-5 3-5-8-5 8-5-3 2 10z"/><path d="M6 20v0"/><path d="M18 20v0"/>'); }
function iconChart(s)    { return svg('<path d="M3 3v18h18"/><path d="m19 9-5 5-4-4-3 3"/>', s || 20); }
function iconGrid(s)     { return svg('<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>', s || 20); }
function iconMoon(s)     { return svg('<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>', s || 20); }
function iconSun(s)      { return svg('<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/>', s || 20); }
function iconGear(s)     { return svg('<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"/>', s || 20); }

function iconBell(s) { return svg('<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>', s || 20); }
function iconSearch(s) { return svg('<circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/>', s || 20); }

function timeAgo(isoStr) {
  const s = Math.floor((Date.now() - new Date(isoStr).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s/60) + 'm ago';
  if (s < 86400) return Math.floor(s/3600) + 'h ago';
  return Math.floor(s/86400) + 'd ago';
}

// ──────────────────────────────────────────────────────────────────────────
// Go
// ──────────────────────────────────────────────────────────────────────────
boot();
