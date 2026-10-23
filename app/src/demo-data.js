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

