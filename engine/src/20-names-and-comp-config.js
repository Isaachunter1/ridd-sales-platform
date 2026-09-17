// ── RIDD Indicators Engine — extracted verbatim from src/58-hall-of-fame-and-rep-names.js ──
// Shared by the app bundle (app.js) and the standalone engine build
// (engine/dist/ridd-engine.js). Edit HERE; both pick it up.

// Convert the raw-sales `dateSold` string (e.g. "5/3/26 9:14 AM" or "5/3/2026")
// into an ISO YYYY-MM-DD so chart buckets can compare consistently.
// Memoized — chart bucket predicates call this once per sale per bucket,
// which multiplies fast on all-time uploads (80+ monthly buckets × 100k rows).
const _dateSoldIsoCache = new Map();
function dateSoldToIso(dateSold) {
  const key = dateSold || '';
  const hit = _dateSoldIsoCache.get(key);
  if (hit !== undefined) return hit;
  let out = '';
  const head = key.split(' ')[0].trim();
  const parts = head.split('/');
  if (parts.length === 3) {
    let [m, d, y] = parts.map(Number);
    if (Number.isFinite(m) && Number.isFinite(d) && Number.isFinite(y)) {
      if (y < 100) y += 2000;
      out = `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    }
  }
  _dateSoldIsoCache.set(key, out);
  return out;
}

// ── Rep-team assignment helpers ──────────────────────────────────────────
// Each rep can be assigned to a team string. Any team whose name is in
// state._indicatorExcludedTeams is dropped from every rep-level metric
// (leaderboard, performance chart, cancel analysis, subscription mix, branch
// rollups). The literal "Excluded" name is the default-excluded team for
// fresh data so existing demo assignments keep working.
const REP_EXCLUDED_TEAM = 'Excluded';
// FieldRoutes sometimes exports doubled spaces in rep names, so older
// team/tier/active assignments may be stored under the raw spelling while
// lookups use the cleaned one (or vice versa). Normalize the keys of every
// rep-keyed config map once per load so both sides always agree.
// Memoized: called per-sale in the team/tier aggregations (100k+ calls on a
// year upload). The result is a pure function of the input string, so caching
// by name is always correct and never needs invalidation. Bounded so a pathological
// dataset can't grow it without limit.
const _cleanRepNameCache = new Map();
function _cleanRepName(n) {
  const key = String(n || '');
  let v = _cleanRepNameCache.get(key);
  if (v !== undefined) return v;
  // Collapse whitespace runs AND normalize comma spacing — FieldRoutes has
  // exported both "Sabbach , Jacob" and "Sabbach, Jacob" for the same human,
  // splitting one rep into two. Any comma spacing becomes ", ".
  v = key.replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  if (_cleanRepNameCache.size < 200000) _cleanRepNameCache.set(key, v);
  return v;
}

// Robust rep-name matching for the rep-keyed config maps (team / tier / office).
// Sales records store names "Last, First" while Manage Teams stores "First Last",
// and casing/punctuation vary — so exact-key lookups miss the majority of the
// roster (~60% in prod). _repNameSig collapses a name to an order-, case- and
// punctuation-insensitive signature ("Dorsey, Evan" and "Evan Dorsey" → same),
// mirroring the _nameSig logic already used for FieldRoutes matching elsewhere.
// _repKeyedLookup does exact → cleaned → signature, in that order, so no rep who
// resolves correctly today can change — we only RECOVER the ones that miss.
const _repNameSigCache = new Map();
function _repNameSig(n) {
  const key = String(n || '');
  let v = _repNameSigCache.get(key);
  if (v !== undefined) return v;
  v = key.toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  if (_repNameSigCache.size < 200000) _repNameSigCache.set(key, v);
  return v;
}
// Per-map signature index, memoized on the map object via a WeakMap (never
// touches serialization). Rebuilt when the key count changes; writers
// (setRepTeam/Tier/Office) invalidate explicitly to catch same-key value edits
// (a rep moving teams).
const _repSigIdxCache = new WeakMap();
function _repSigIndex(map) {
  if (!map || typeof map !== 'object') return {};
  const count = Object.keys(map).length;
  const cached = _repSigIdxCache.get(map);
  if (cached && cached.count === count) return cached.idx;
  const idx = Object.create(null);
  for (const k of Object.keys(map)) { const s = _repNameSig(k); if (!(s in idx)) idx[s] = map[k]; }
  _repSigIdxCache.set(map, { idx, count });
  return idx;
}
function _repKeyedLookup(map, repName) {
  if (!map || !repName) return '';
  const exact = map[repName] || map[_cleanRepName(repName)];
  if (exact) return exact;
  return _repSigIndex(map)[_repNameSig(repName)] || '';
}

// ── Competitions ──────────────────────────────────────────────────────────
// Comps run year-round and reuse the same metrics, so exclusions are scoped
// PER COMPETITION rather than globally. Each competition has its own list of
// excluded teams; the active competition's list is what drives every number
// while Comps mode is on. Seeded with Top Gun + Spring Cleaning, inheriting
// any legacy global exclusions so nothing that was hidden becomes visible.
const DEFAULT_COMPETITIONS = [
  { id: 'top_gun',          name: 'Top Gun', scoring: 'top_gun' },
  { id: 'spring_cleaning',  name: 'Spring Cleaning',  scoring: 'spring_cleaning' },
  { id: 'last_man_standing',name: 'The Arena', scoring: 'last_man_standing' },   // "The Arena" on the 2026 schedule (per Isaac)
  { id: 'nrla',             name: 'NRLA', scoring: 'nrla' },
  { id: 'avg_pest_initial', name: 'Avg Pest & Raffle', scoring: 'avg_pest_initial' },
];
function getIndicatorCompetitions() {
  if (!Array.isArray(state._indicatorCompetitions) || state._indicatorCompetitions.length === 0) {
    const legacy = Array.isArray(state._indicatorExcludedTeams) && state._indicatorExcludedTeams.length
      ? state._indicatorExcludedTeams.slice()
      : [REP_EXCLUDED_TEAM];
    state._indicatorCompetitions = DEFAULT_COMPETITIONS.map(c => ({ ...c, excludedTeams: legacy.slice() }));
  }
  // Cleanup: the standalone Raffle competition was merged into Avg Pest &
  // Raffle — drop it from older saved configs.
  if (state._indicatorCompetitions.some(c => c.id === 'raffle')) {
    state._indicatorCompetitions = state._indicatorCompetitions.filter(c => c.id !== 'raffle');
    if (state._indicatorActiveCompId === 'raffle') state._indicatorActiveCompId = 'avg_pest_initial';
  }
  // Heal: make sure the built-in scoring competitions exist even on configs
  // saved before they were added, and backfill the scoring tag / rename on any
  // built-in that's stale.
  const byId = new Map(state._indicatorCompetitions.map(c => [c.id, c]));
  { const ap = byId.get('avg_pest_initial'); if (ap) ap.name = 'Avg Pest & Raffle'; }
  { const lms = byId.get('last_man_standing'); if (lms && /last man standing/i.test(lms.name || '')) lms.name = 'The Arena'; }
  const _removedDefaults = new Set(state._indicatorRemovedDefaults || []);
  DEFAULT_COMPETITIONS.forEach(d => {
    const existing = byId.get(d.id);
    if (!existing) { if (!_removedDefaults.has(d.id)) state._indicatorCompetitions.push({ ...d, excludedTeams: [REP_EXCLUDED_TEAM] }); }
    else if (d.scoring && !existing.scoring) existing.scoring = d.scoring;
  });
  // Defensive: every competition must carry an excludedTeams array.
  state._indicatorCompetitions.forEach(c => { if (!Array.isArray(c.excludedTeams)) c.excludedTeams = [REP_EXCLUDED_TEAM]; });
  return state._indicatorCompetitions;
}
function getActiveCompId() {
  const comps = getIndicatorCompetitions();
  if (!state._indicatorActiveCompId || !comps.some(c => c.id === state._indicatorActiveCompId)) {
    state._indicatorActiveCompId = comps[0].id;
  }
  return state._indicatorActiveCompId;
}

function getActiveComp() {
  const comps = getIndicatorCompetitions();
  return comps.find(c => c.id === getActiveCompId()) || comps[0];
}

// LMS runs on SCHEDULED DAYS, not a free date window. Default = every
// Saturday, with baked-in holiday swaps: July 4 2026 (a Saturday) was a
// holiday, so THIS YEAR that round ran on FRIDAY July 3 instead. An admin-set
// comp.compDays list (Competitions tab → Comp Days bar) overrides everything —
// those exact dates ARE the rounds, in order.
const LMS_EXTRA_DAYS = new Set(['2026-07-03']);   // counts like a Saturday
const LMS_SKIP_DAYS  = new Set(['2026-07-04']);   // holiday — no round
function lastManStandingCompute(sales, compOverride) {
  const _comp = compOverride || (typeof getActiveComp === 'function' ? getActiveComp() : null);
  // An EMPTY compDays list is a real state (season cleared → zero rounds);
  // auto-Saturdays only when the list has never been configured at all.
  const _custom = (_comp && Array.isArray(_comp.compDays)) ? new Set(_comp.compDays) : null;
  const _isCompDay = (d, iso) => _custom
    ? _custom.has(iso)
    : ((d.getDay() === 6 || LMS_EXTRA_DAYS.has(iso)) && !LMS_SKIP_DAYS.has(iso));
  const dayOf = (s) => (typeof _parseIndicatorDay === 'function') ? _parseIndicatorDay(s) : ((s && s.date) || null);
  // SEASON FENCE — the dataset carries multiple YEARS of history (for the
  // YoY charts), but this comp is one season. Without this fence the roster
  // swept in every rep who ever sold (2024/2025 ghosts piling into the
  // "eliminated" list) and auto-Saturday mode could even mint rounds from
  // prior years. Season year = the year of the first scheduled comp day
  // (or the current year when running on auto-Saturdays).
  const _seasonYear = (() => {
    if (_custom && _custom.size) {
      const first = [...(_custom)].sort()[0];
      const y = Number(String(first).slice(0, 4));
      if (y > 2000) return y;
    }
    return new Date().getFullYear();
  })();
  const _seasonStart = new Date(_seasonYear, 0, 1);
  const d2d = (sales || []).filter(s => {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') return false;
    const d0 = dayOf(s);
    return d0 && !isNaN(d0) && d0 >= _seasonStart;
  });
  const repOffice = {}; const roster = [];
  for (const s of d2d) { const r = s.rep ? getCanonicalRepName(s.rep) : ''; if (r && !(r in repOffice)) { repOffice[r] = s.office || ''; roster.push(r); } }
  // Qualifying revenue per rep per comp day.
  const byWeek = {};
  for (const s of d2d) {
    const d = dayOf(s); if (!d || isNaN(d) || !_isCompDay(d, d.toISOString().slice(0, 10))) continue;   // scheduled comp days only
    // Qualifying gate — assume-passing, matching Spring Cleaning standings:
    // passed + no-audit + pending all count; only Failed Audit and <$99 (Last
    // Resort) are excluded. Lets the comp run on recent windows before audits land.
    if (typeof springCleaningStatus === 'function' && springCleaningStatus(s) === 'excluded') continue;
    // Sandbag guard — must be serviced by the following Friday. Past that Friday,
    // unserviced or serviced-late accounts drop out of the round.
    if (typeof lmsServicedStatus === 'function' && lmsServicedStatus(s) === 'late') continue;
    const iso = d.toISOString().slice(0, 10);
    (byWeek[iso] = byWeek[iso] || {});
    const _cn = getCanonicalRepName(s.rep);
    byWeek[iso][_cn] = (byWeek[iso][_cn] || 0) + (Number(s.contractValue) || 0);
  }
  const saturdays = Object.keys(byWeek).sort();
  let alive = new Set(roster);
  const cum = {}; roster.forEach(r => (cum[r] = 0));
  const rounds = [];
  for (const iso of saturdays) {
    if (alive.size <= 1) break;                                       // champion already decided
    const wk = byWeek[iso];
    const contenders = [...alive].map(rep => {
      const rev = wk[rep] || 0;
      return { rep, office: repOffice[rep] || '', rev, cum: (cum[rep] || 0) + rev };
    });
    contenders.sort((a, b) => b.rev - a.rev || b.cum - a.cum || String(a.rep).localeCompare(String(b.rep)));
    const isQualifier = rounds.length === 0;                          // Round 1 = pure qualifier
    let advanceN;
    if (isQualifier) {
      // Round 1 is a pure qualifier: every rep with a qualifying (passed-audit)
      // account this Saturday advances — no halving. Reps with no qualifying
      // sale are eliminated. The weekly top-50% cut starts in Round 2.
      contenders.forEach(c => { c.advanced = c.rev > 0; cum[c.rep] = c.cum; });
      advanceN = contenders.filter(c => c.advanced).length;
    } else if (contenders.length <= 3) {
      // FINAL ROUND (per Isaac): once the field is down to 3 or fewer, the
      // round-up rule retires — winner-take-all, top revenue is champion.
      advanceN = 1;
      contenders.forEach((c, i) => { c.advanced = i < 1; cum[c.rep] = c.cum; });
    } else {
      advanceN = Math.max(1, Math.ceil(contenders.length / 2));       // top 50%, rounded UP
      contenders.forEach((c, i) => { c.advanced = i < advanceN; cum[c.rep] = c.cum; });
    }
    rounds.push({ iso, week: rounds.length + 1, contenders, advanceN, before: contenders.length, qualifier: isQualifier, final: !isQualifier && contenders.length <= 3 });
    alive = new Set(contenders.filter(c => c.advanced).map(c => c.rep));
  }
  return { rounds, alive: [...alive], champion: alive.size === 1 ? [...alive][0] : null, rosterSize: roster.length, repOffice, cum, saturdays };
}

// Per-comp config, persisted on the competition object itself (syncs to every
// admin like Spring Cleaning's settings do).
function nrlaConfig(comp) {
  const c = comp || getActiveComp(); if (!c) return null;
  if (!c.nrla || typeof c.nrla !== 'object') c.nrla = {};
  const n = c.nrla;
  // 2026 format (flyer): season July 6 – July 18, 4 seeding rounds, then a
  // playoff (semifinal) round and a championship round — 2 days per round.
  // Start + End dates define the season: 2-day rounds fill the window and the
  // LAST TWO become semifinal + championship. Update the two dates each year
  // and the whole season lays itself out.
  // Seed defaults only when the keys have NEVER been set — an empty string
  // is a deliberate ↺ Reset and must stay empty (no self-heal fighting it).
  if (typeof n.start !== 'string') n.start = '2026-07-06';
  if (typeof n.end !== 'string') n.end = '2026-07-18';
  n.seedRounds = Math.min(12, Math.max(1, Math.round(Number(n.seedRounds) || 4)));   // fallback when no end date is set
  if (!Array.isArray(n.teamOrder)) n.teamOrder = null;   // 🎲 shuffled matchup order
  n.groups = Number(n.groups) === 1 ? 1 : 2;              // two groups by # of reps (poster) or one table
  if (!n.teamNames || typeof n.teamNames !== 'object') n.teamNames = {};  // branch → display name (Ganadores, Dawgs, …)
  if (!n.rosters || typeof n.rosters !== 'object') n.rosters = {};        // team → [competing rep names]; empty = whole branch
  // Heal rosters after rep MERGES (per Isaac — the Pere spellings): app-wide
  // merges alias the old spelling to the canonical name, but these stored
  // lists kept the old strings and stopped matching. Map every stored name
  // through the alias table and collapse duplicates, every render.
  try {
    Object.keys(n.rosters).forEach(k => {
      const arr = n.rosters[k];
      if (!Array.isArray(arr)) { delete n.rosters[k]; return; }
      const healed = [...new Set(arr.map(x => getCanonicalRepName(x)))].sort();
      n.rosters[k] = healed;   // [] stays — an explicit empty roster means NOBODY competes
    });
    Object.keys(n.repIds || {}).forEach(k => {
      const canon = getCanonicalRepName(k);
      if (canon !== k) { if (!n.repIds[canon]) n.repIds[canon] = n.repIds[k]; delete n.repIds[k]; }
    });
  } catch (e) { /* alias table not loaded yet — the next render heals */ }
  if (!n.matchups || typeof n.matchups !== 'object') n.matchups = {};     // roundNum → [[a,b],…] drag-and-drop overrides
  if (!n.repIds || typeof n.repIds !== 'object') n.repIds = {};           // rep name → FieldRoutes sales-rep ID (reference / future ID matching)
  if (!n.branchTz || typeof n.branchTz !== 'object') n.branchTz = {};      // branch → IANA time zone (new markets set here, no code change)
  if (!Array.isArray(c.excludedBranches)) c.excludedBranches = [];
  return n;
}
const _nrlaDay = (isoStr) => { if (!isoStr) return null; const d = new Date(isoStr + 'T00:00'); return isNaN(d) ? null : d; };

// Round windows: 2-day blocks from the start date, skipping Sundays.
function nrlaRoundWindows(cfg) {
  const start = _nrlaDay(cfg.start);
  if (!start) return [];
  const next = (d) => { const x = new Date(d); do { x.setDate(x.getDate() + 1); } while (x.getDay() === 0); return x; };
  const rounds = [];
  let d1 = new Date(start);
  while (d1.getDay() === 0) d1.setDate(d1.getDate() + 1);   // never open a round on Sunday
  for (let i = 0; i < cfg.rounds; i++) {
    const d2 = next(d1);
    rounds.push({ num: i + 1, d1: new Date(d1), d2: new Date(d2) });
    d1 = next(d2);
  }
  return rounds;
}
// Circle-method round robin. Odd team counts get a BYE (null opponent). If
// more rounds are scheduled than a single round robin holds, it cycles.
function nrlaSchedule(teams, roundsWanted) {
  const t = teams.slice();
  if (t.length < 2) return [];
  if (t.length % 2) t.push(null);
  const n = t.length, per = n - 1, arr = t.slice(), one = [];
  for (let r = 0; r < per; r++) {
    const pairs = [];
    for (let i = 0; i < n / 2; i++) pairs.push([arr[i], arr[n - 1 - i]]);
    one.push(pairs);
    arr.splice(1, 0, arr.pop());
  }
  const rounds = [];
  for (let i = 0; i < roundsWanted; i++) rounds.push(one[i % per]);
  return rounds;
}

// Rep → team transfers (comp purposes only) — same store Spring Cleaning uses.
function nrlaApplyOverrides(sales, comp) {
  const ov = (comp && comp.repBranchOverrides && typeof comp.repBranchOverrides === 'object') ? comp.repBranchOverrides : {};
  if (!Object.keys(ov).length) return sales || [];
  return (sales || []).map(s => {
    const o = ov[_cleanRepName(getCanonicalRepName(s.rep || ''))];
    return (o && o !== s.office) ? { ...s, office: o } : s;
  });
}
// ── 2026 seeding schedule (flyer) — used verbatim whenever all eight flyer
// teams are in play. Round 1: Jul 6-7 · R2: 8-9 · R3: 10-11 · R4: 13-14.
const NRLA_2026_SCHEDULE = [
  [['VIRGINIA BEACH','CHARLESTON'],['DESTIN','RALEIGH'],['DETROIT','ATLANTA'],['JOPLIN','MYRTLE BEACH']],
  [['VIRGINIA BEACH','RALEIGH'],['MYRTLE BEACH','DETROIT'],['CHARLESTON','DESTIN'],['ATLANTA','JOPLIN']],
  [['VIRGINIA BEACH','DETROIT'],['MYRTLE BEACH','RALEIGH'],['JOPLIN','DESTIN'],['CHARLESTON','ATLANTA']],
  [['VIRGINIA BEACH','MYRTLE BEACH'],['DETROIT','RALEIGH'],['CHARLESTON','JOPLIN'],['ATLANTA','DESTIN']],
];
// Prize pool (flyer) — per rep, by final placement.
const NRLA_PRIZE_POOL = ['®400K + Team Trip', '®325K', '®250K', '®175K', '®125K', '®100K', '®75K', '®50K'];
const nrlaOrdinal = (n) => n === 1 ? '1st' : n === 2 ? '2nd' : n === 3 ? '3rd' : n + 'th';

// Seeding-round pairings: the 2026 flyer schedule when it covers the field,
// otherwise a generated round robin (which the 🎲 rotation can turn).
// Drag-and-drop matchup overrides (cfg.matchups[roundNum]) win over the base
// schedule for that round. Overrides self-heal when the team set changes:
// vanished teams empty their slot, new teams fill empty slots or append.
function nrlaApplyRoundOverride(basePairs, override, teams) {
  if (!Array.isArray(override) || !override.length) return basePairs;
  const cur = new Set(teams);
  const seen = new Set();
  const pairs = [];
  override.forEach(p => {
    if (!Array.isArray(p)) return;
    let a = p[0] != null ? String(p[0]).toUpperCase() : null;
    let b = p[1] != null ? String(p[1]).toUpperCase() : null;
    if (a && (!cur.has(a) || seen.has(a))) a = null;
    if (b && (!cur.has(b) || seen.has(b))) b = null;
    if (a) seen.add(a);
    if (b) seen.add(b);
    if (a || b) pairs.push([a, b]);
  });
  const missing = teams.filter(t => !seen.has(t));
  if (missing.length) {
    pairs.forEach(p => { if (!p[0] && missing.length) p[0] = missing.shift(); if (!p[1] && missing.length) p[1] = missing.shift(); });
    while (missing.length) pairs.push([missing.shift(), missing.length ? missing.shift() : null]);
  }
  return pairs.length ? pairs : basePairs;
}
function nrlaSeedSchedule(teams, seedN, cfg) {
  const flyerTeams = [...new Set(NRLA_2026_SCHEDULE.flat(2))];
  const cur = new Set(teams);
  let base, flyer = false;
  if (flyerTeams.every(t => cur.has(t))) {
    base = []; flyer = true;
    for (let i = 0; i < seedN; i++) base.push(NRLA_2026_SCHEDULE[i % NRLA_2026_SCHEDULE.length]);
  } else {
    let order = teams;
    if (Array.isArray(cfg.teamOrder) && cfg.teamOrder.length) {
      const kept = cfg.teamOrder.map(t => String(t).toUpperCase()).filter(t => cur.has(t));
      const keptSet = new Set(kept);
      order = kept.concat(teams.filter(t => !keptSet.has(t)));
    }
    base = nrlaSchedule(order, seedN);
  }
  const rounds = base.map((pairs, i) => nrlaApplyRoundOverride(pairs, (cfg.matchups || {})[i + 1], teams));
  return { rounds, flyer };
}
