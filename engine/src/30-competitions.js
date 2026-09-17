// ── RIDD Indicators Engine — extracted verbatim from src/60-nrla-and-comps.js ──
// Shared by the app bundle (app.js) and the standalone engine build
// (engine/dist/ridd-engine.js). Edit HERE; both pick it up.

function nrlaCompute(rawSales, compOverride) {
  const comp = compOverride || getActiveComp();
  const cfg = nrlaConfig(comp);
  const exB = new Set((comp.excludedBranches || []).map(b => String(b).toUpperCase()));
  const offOf = (s) => String(s.office || 'UNKNOWN').toUpperCase();
  // WHAT COUNTS: Pending/Serviced production only — strictly. An account that
  // was sold but never serviced — cancelled at the door, frozen, no initial
  // appointment scheduled, or the appointment cancelled/no-showed — is
  // excluded from EVERYTHING: revenue columns, PRA, round scores. Same
  // Sold-Not-Started test Spring Cleaning uses: real production = serviced OR
  // Active with a Pending initial appointment. (A brand-new sale can read
  // "No Appointment" until the nightly warehouse batch catches up — it joins
  // the board as soon as the sync shows its appointment. No grace window, by
  // design: the synced data is the source of truth at all times.)
  let sales = nrlaApplyOverrides(rawSales, comp)
    .filter(s => _indicatorDeptOf(s) === 'd2d'
      && (typeof frPendingServiced !== 'function' || frPendingServiced(s)));
  // Rosters (📋) — AUTHORITATIVE team lists. A rep on a roster counts for
  // THAT team, wherever they actually knock. A team WITH a roster counts only
  // its rostered reps; a team without one counts everyone knocking under its
  // banner. Drives every round, the revenue columns, and the PRA denominator.
  const rosters = {};
  Object.entries(cfg.rosters || {}).forEach(([t, list]) => {
    if (Array.isArray(list)) rosters[String(t).toUpperCase()] = new Set(list.map(r => _cleanRepName(getCanonicalRepName(String(r)))));   // [] = explicit NOBODY (opt-in mode, per Isaac)
  });
  const repRosterTeam = {};
  Object.entries(rosters).forEach(([t, set]) => set.forEach(r => { if (!(r in repRosterTeam)) repRosterTeam[r] = t; }));
  if (Object.keys(rosters).length) {
    sales = sales.reduce((out, s) => {
      const key = _cleanRepName(getCanonicalRepName(s.rep || ''));
      const rt = repRosterTeam[key];
      if (rt) { out.push(rt === offOf(s) ? s : { ...s, office: rt }); return out; }
      if (!rosters[offOf(s)]) out.push(s);
      return out;
    }, []);
  }
  sales = sales.filter(s => !exB.has(offOf(s)));
  // Rounds fill the [start, end] window: consecutive 2-day blocks (Sundays
  // skipped) up to the end date. The LAST TWO rounds are the playoffs
  // (semifinal + championship); everything before them is seeding.
  let windows;
  if (cfg.end && _nrlaDay(cfg.end)) {
    const endD = _nrlaDay(cfg.end);
    windows = nrlaRoundWindows({ start: cfg.start, rounds: 30 }).filter(w => w.d2 <= endD);
    if (!windows.length) windows = nrlaRoundWindows({ start: cfg.start, rounds: 1 });
    windows = windows.map((w, i) => ({ ...w, num: i + 1 }));
  } else {
    windows = nrlaRoundWindows({ start: cfg.start, rounds: cfg.seedRounds + 2 });
  }
  const seedN = Math.max(1, windows.length - 2);
  const seasonStart = windows.length ? windows[0].d1 : null;
  const seasonEnd   = windows.length ? windows[windows.length - 1].d2 : null;
  // Teams = every rostered team + every branch with season activity — PLUS
  // the flyer's eight teams, always (unless benched). A brand-new branch like
  // Joplin stays on the board at $0 before its first knock — and even before
  // its roster syncs to another admin's browser — instead of vanishing. A $0
  // team still plays its matchups (and loses them) like anyone else.
  const teamSet = new Set(Object.keys(rosters).filter(t => !exB.has(t)));
  NRLA_2026_SCHEDULE.flat(2).filter(Boolean).forEach(t => { if (!exB.has(t)) teamSet.add(t); });
  if (seasonStart) for (const s of sales) {
    const d = _parseIndicatorDay(s); if (!d || d < seasonStart || d > seasonEnd) continue;
    const o = offOf(s); if (o && o !== 'UNKNOWN') teamSet.add(o);
  }
  const teams = [...teamSet].sort();
  // COMP REVENUE GATE: only Passed-audit and Pending-audit accounts count
  // toward round scores and PRA. Failed Audit + Last Resort (<$99) are OUT of
  // the competition entirely (they still show in the Failed Rev column).
  // Pending is assumed passing until flagged — so a round's result can move
  // while audits land, which is why a round only LOCKS once every account in
  // it has been audited (pendingAudits === 0).
  const _isFailedAcct = (s) => (Number(s.initialPrice) || 0) < 99 || SC_FAIL_RE.test(s.customerFlags || '');
  const _isPendingAudit = (s) => !_isFailedAcct(s) && !scAuditPassed(s.customerFlags);
  const roundRev = windows.map(() => ({}));
  const roundRevDay = windows.map(() => ({}));     // team → [day1 qual rev, day2 qual rev]
  const roundReps = windows.map(() => ({}));
  const roundPending = windows.map(() => 0);
  const roundBuckets = windows.map(() => ({}));    // team → { passed, pending, failed } contract $
  const roundRepStats = windows.map(() => ({}));   // per-round per-rep buckets (rep leaderboard scope picker)
  if (windows.length) for (const s of sales) {
    const d = _parseIndicatorDay(s);
    if (!d || d < seasonStart || d > seasonEnd) continue;
    for (let i = 0; i < windows.length; i++) {
      const w = windows[i];
      if (d >= w.d1 && d <= w.d2) {
        if (_isPendingAudit(s)) roundPending[i] += 1;
        if (s.rep) {
          const rk0 = _cleanRepName(getCanonicalRepName(s.rep));
          const rr0 = roundRepStats[i][rk0] || (roundRepStats[i][rk0] = { team: offOf(s), n: 0, total: 0, passed: 0, pending: 0, failed: 0 });
          const cv0 = Number(s.contractValue) || 0;
          const b0 = _isFailedAcct(s) ? 'failed' : (scAuditPassed(s.customerFlags) ? 'passed' : 'pending');
          rr0.n += 1; rr0.total += cv0; rr0[b0] += cv0;
        }
        {
          const oB = offOf(s);
          const cvB = Number(s.contractValue) || 0;
          const bB = _isFailedAcct(s) ? 'failed' : (scAuditPassed(s.customerFlags) ? 'passed' : 'pending');
          const tb = roundBuckets[i][oB] || (roundBuckets[i][oB] = { passed: 0, pending: 0, failed: 0 });
          tb[bB] += cvB;
        }
        if (!_isFailedAcct(s)) {
          const o = offOf(s);
          const cv1 = Number(s.contractValue) || 0;
          roundRev[i][o] = (roundRev[i][o] || 0) + cv1;
          (roundRevDay[i][o] = roundRevDay[i][o] || [0, 0])[d.getTime() === w.d1.getTime() ? 0 : 1] += cv1;
          (roundReps[i][o] = roundReps[i][o] || new Set()).add(s.rep);
        }
        break;
      }
    }
  }
  // Season revenue columns — audit-flag buckets (same tokens Spring Cleaning
  // and Top Gun use): failed = Failed Audit or Last Resort (<$99), passed =
  // Passed/No Audit, pending = not flagged yet.
  const seasonStats = {};
  const repStats = {};             // team → { repName → per-rep season stats } (standings drill-down)
  const accounts = [];             // every counted account (admin drill-down on the revenue columns)
  const _roundIdxOf = (d) => { for (let i = 0; i < windows.length; i++) { if (d >= windows[i].d1 && d <= windows[i].d2) return i; } return -1; };
  teams.forEach(t => { seasonStats[t] = { total: 0, passed: 0, pending: 0, failed: 0, n: 0, repSet: new Set() }; repStats[t] = {}; });
  if (windows.length) for (const s of sales) {
    const d = _parseIndicatorDay(s);
    if (!d || d < seasonStart || d > seasonEnd) continue;
    const t = offOf(s);
    const st = seasonStats[t]; if (!st) continue;
    const cv = Number(s.contractValue) || 0;
    const bucket = ((Number(s.initialPrice) || 0) < 99 || SC_FAIL_RE.test(s.customerFlags || '')) ? 'failed'
      : (scAuditPassed(s.customerFlags) ? 'passed' : 'pending');
    st.total += cv; st[bucket] += cv; st.n += 1;
    accounts.push({
      team: t,
      rep: s.rep ? _cleanRepName(getCanonicalRepName(s.rep)) : '—',
      customer: s.customer || '', customerId: s.customerId || '',
      dateSold: s.dateSold || '', date: d,
      revenue: cv, bucket, roundIdx: _roundIdxOf(d),
    });
    if (s.rep) {
      st.repSet.add(s.rep);
      const rk = _cleanRepName(getCanonicalRepName(s.rep));
      const rr = repStats[t][rk] || (repStats[t][rk] = { n: 0, total: 0, passed: 0, pending: 0, failed: 0 });
      rr.n += 1; rr.total += cv; rr[bucket] += cv;
    }
  }
  // Reps competing = roster size when set, otherwise every rep who sold this
  // season. This is the PRA denominator for every round.
  const repsCompeting = {};
  teams.forEach(t => { repsCompeting[t] = rosters[t] ? rosters[t].size : seasonStats[t].repSet.size; });
  // THE METRIC (flyer): win a round by posting a higher Per-Rep Average than
  // the team you're up against. PRA = round revenue ÷ reps competing.
  const praOf = (t, i) => { const n = repsCompeting[t] || 0; return n > 0 ? (roundRev[i][t] || 0) / n : 0; };
  const mk = (t, i) => {
    if (t == null) return null;
    const n = repsCompeting[t] || 0;
    const dd = roundRevDay[i][t] || [0, 0];
    const bk = roundBuckets[i][t] || { passed: 0, pending: 0, failed: 0 };
    return {
      team: t, rev: roundRev[i][t] || 0, reps: n,
      pra: praOf(t, i), sellers: (roundReps[i][t] || new Set()).size,
      praD1: n > 0 ? dd[0] / n : 0, praD2: n > 0 ? dd[1] / n : 0,
      buckets: bk, totalRev: bk.passed + bk.pending + bk.failed,
    };
  };
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const rounds = windows.map((w, i) => ({
    ...w, started: today >= w.d1, done: today > w.d2, live: today >= w.d1 && today <= w.d2,
    pendingAudits: roundPending[i],
    locked: today > w.d2 && roundPending[i] === 0,   // every account audited → result locked
    phase: i < seedN ? 'seed' : (i === seedN ? 'semi' : 'final'), matchups: [],
  }));
  // ── Seeding rounds ──
  const sched = nrlaSeedSchedule(teams, Math.min(seedN, rounds.length), cfg);
  // MAKE-UP MATCHES (one-offs) — a matchup that couldn't be played in its
  // scheduled window gets REPLAYED inside another round's dates: the
  // ORIGINAL round's result for those two teams is scored from the make-up
  // window instead. Both teams' production in that window ALSO counts for
  // their regularly scheduled matchup — they're fighting two opponents at
  // once. Jul 2026: Joplin was moving markets during Round 1, so Myrtle
  // Beach vs Joplin replays over Round 4's dates (Jul 13–14) and counts as
  // the ROUND 1 result.
  const NRLA_MAKEUPS = [
    { round: 0, teams: ['MYRTLE BEACH', 'JOPLIN'], windowRound: 3 },
  ];
  const _muDspan = (w) => (w.d1.getMonth() + 1) + '/' + w.d1.getDate() + '–' + (w.d2.getMonth() + 1) + '/' + w.d2.getDate();
  const stand = {}; teams.forEach(t => { stand[t] = { team: t, w: 0, l: 0, t: 0, cumPra: 0, results: [] }; });
  const h2h = {};   // 'A|B' (sorted) → winning team, from seeding rounds
  for (let i = 0; i < Math.min(seedN, rounds.length); i++) {
    const rd = rounds[i];
    (sched.rounds[i] || []).forEach(([a, b]) => {
      const mu = NRLA_MAKEUPS.find(m => m.round === i && rounds[m.windowRound] && a && b
        && [a, b].every(t => m.teams.some(x => String(x).toUpperCase() === String(t).toUpperCase())));
      const wi = mu ? mu.windowRound : i;              // which window scores this matchup
      const startedEff = mu ? rounds[wi].started : rd.started;
      // A make-up counts NOTHING until its window is over — no provisional
      // W/L while both teams are still out competing (per Isaac): the result
      // stays blank, not a tie, and standings ignore it entirely.
      const muPending = !!(mu && !rounds[wi].done);
      const A = mk(a, wi), B = mk(b, wi);
      let winner = null;
      if (startedEff && !muPending) {
        if (A && !B) winner = a;                       // bye = automatic win
        else if (B && !A) winner = b;
        else if (A && B && A.pra !== B.pra) winner = A.pra > B.pra ? a : b;
      }
      rd.matchups.push({ a: A, b: B, winner, bye: !A || !B, _muPending: muPending,
        tag: mu ? ('Make-up · ' + (muPending ? 'IN PROGRESS ' : 'played ') + _muDspan(rounds[wi])) : undefined });
      if (startedEff && !muPending) {
        if (A && B && winner) h2h[[a, b].sort().join('|')] = winner;
        [A, B].forEach(side => {
          if (!side) return;
          const st = stand[side.team]; if (!st) return;
          st.cumPra += side.pra;
          if (!(!A || !B) && winner === null) { st.t += 1; st.results.push('T'); }
          else if (winner === side.team) { st.w += 1; st.results.push('W'); }
          else { st.l += 1; st.results.push('L'); }
        });
      }
    });
  }
  // ── Seeds (flyer): 1. overall record · 2. head-to-head · 3. cumulative PRA ──
  const standings = teams.map(t => stand[t]).sort((x, y) => {
    if (y.w !== x.w) return y.w - x.w;
    if (x.l !== y.l) return x.l - y.l;
    const hw = h2h[[x.team, y.team].sort().join('|')];
    if (hw === x.team) return -1;
    if (hw === y.team) return 1;
    return y.cumPra - x.cumPra || (seasonStats[y.team].total - seasonStats[x.team].total) || String(x.team).localeCompare(String(y.team));
  });
  const seeds = standings.map(s => s.team);
  const seedingDone = rounds.slice(0, seedN).every(r => r.done) && rounds.length >= seedN;
  // ── Playoffs: semifinal round pairs #1v#4 · #2v#3 (then #5v#8 · #6v#7 …) ──
  const semiIdx = seedN, finalIdx = seedN + 1;
  const semiResults = [];
  if (rounds[semiIdx]) {
    const rd = rounds[semiIdx];
    const pairs = [];
    for (let base = 0; base + 3 < seeds.length; base += 4) { pairs.push([base + 1, base + 4]); pairs.push([base + 2, base + 3]); }
    const covered = Math.floor(seeds.length / 4) * 4;
    for (let i = covered; i + 1 < seeds.length; i += 2) pairs.push([i + 1, i + 2]);
    pairs.forEach(([sa, sb]) => {
      const a = seedingDone ? seeds[sa - 1] : null, b = seedingDone ? seeds[sb - 1] : null;
      const A = a ? mk(a, semiIdx) : null, B = b ? mk(b, semiIdx) : null;
      let winner = null;
      if (a && b && rd.started) winner = A.pra === B.pra ? a : (A.pra > B.pra ? a : b);  // dead tie → higher seed
      rd.matchups.push({ a: A, b: B, winner, bye: false, aLabel: a ? null : '#' + sa + ' seed', bLabel: b ? null : '#' + sb + ' seed', tag: '#' + sa + ' vs #' + sb });
      semiResults.push({ sa, sb, winner: rd.done ? winner : null, loser: rd.done && winner ? (winner === a ? b : a) : null });
    });
  }
  // ── Championship: winners → place match, losers → the one below ──
  const placements = [];
  if (rounds[finalIdx]) {
    const rd = rounds[finalIdx];
    for (let k = 0; k + 1 < semiResults.length; k += 2) {
      const s1 = semiResults[k], s2 = semiResults[k + 1];
      const pTop = 2 * k + 1;                            // k=0 → 1st/3rd · k=2 → 5th/7th
      [[s1.winner, s2.winner, 'Winner #' + s1.sa + '/#' + s1.sb, 'Winner #' + s2.sa + '/#' + s2.sb, pTop],
       [s1.loser,  s2.loser,  'Loser #'  + s1.sa + '/#' + s1.sb, 'Loser #'  + s2.sa + '/#' + s2.sb, pTop + 2],
      ].forEach(([x, y, xl, yl, place]) => {
        const X = x ? mk(x, finalIdx) : null, Y = y ? mk(y, finalIdx) : null;
        let winner = null;
        if (x && y && rd.started) winner = X.pra === Y.pra ? x : (X.pra > Y.pra ? x : y);
        rd.matchups.push({ a: X, b: Y, winner, bye: false, aLabel: x ? null : xl, bLabel: y ? null : yl, tag: nrlaOrdinal(place) + ' Place Match' });
        if (x && y && rd.done && winner) {
          placements.push({ place, team: winner, prize: NRLA_PRIZE_POOL[place - 1] || '' });
          placements.push({ place: place + 1, team: winner === x ? y : x, prize: NRLA_PRIZE_POOL[place] || '' });
        }
      });
    }
    placements.sort((a, b) => a.place - b.place);
  }
  const seasonDone = !!(rounds.length && rounds.every(r => r.done));
  return { comp, cfg, teams, rounds, standings, seeds, seedingDone, seedN, semiResults, placements,
           seasonDone, seasonStats, repStats, roundRepStats, repsCompeting, rosters, accounts, usedFlyerSchedule: sched.flyer };
}

// ── \ud83d\udc0d KOBE WEEK — beat your own best week (Aug 3\u20138) ──────────
// Personal-record comp: every rep\u2019s baseline is their BEST Sun\u2013Sat week
// of the season BEFORE the comp window. Beat it inside Aug 3\u20138 and Kobe
// Week is earned. No money, no RIDDCOIN \u2014 a framed custom "24" jersey,
// signed live at the gala. Revenue basis: canonical Pending/Serviced,
// D2D only (same as the leaderboard). The pacer splits what\u2019s left to
// beat across the remaining comp days.
const KOBE_FROM = '2026-08-03';
const KOBE_TO   = '2026-08-08';
function kobeWeekCompute(raw, KOBE_FROM, KOBE_TO, BASE_YEAR) {
  const weekKeyOf = (iso) => {
    const d = new Date(iso + 'T00:00');
    if (isNaN(d)) return null;
    d.setDate(d.getDate() - d.getDay());          // Sunday start (company weeks)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const base = new Map();    // rep -> { wk: rev } (weeks BEFORE the window)
  const cur = new Map();     // rep -> { total, byDay: {} } (inside the window)
  for (const s of (raw || [])) {
    if (typeof _indicatorDeptOf === 'function' && _indicatorDeptOf(s) !== 'd2d') continue;
    if (typeof frPendingServiced === 'function' && !frPendingServiced(s)) continue;
    // Failed audits + Last Resorts are OUT (per Isaac) — applies to the
    // baseline best week AND the live comp week alike. No-audit accounts
    // still count (only a FAILED flag excludes).
    if ((Number(s.initialPrice) || 0) < 99) continue;
    if (typeof SC_FAIL_RE !== 'undefined' && SC_FAIL_RE.test(s.customerFlags || '')) continue;
    const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(s.dateSold) : '';
    if (!iso) continue;
    const nm = getCanonicalRepName(s.rep);
    if (!nm) continue;
    const cv = Number(s.contractValue) || 0;
    if (iso >= KOBE_FROM && iso <= KOBE_TO) {
      const c = cur.get(nm) || { total: 0, byDay: {} };
      c.total += cv; c.byDay[iso] = (c.byDay[iso] || 0) + cv;
      cur.set(nm, c);
    } else if (BASE_YEAR
      ? (iso >= BASE_YEAR + '-01-01' && iso <= BASE_YEAR + '-12-31')
      : (iso < KOBE_FROM && iso >= KOBE_FROM.slice(0, 4) + '-01-01')) {
      // Baseline is scoped to ONE year (per Isaac) — the comp year by
      // default, or an explicit BASE_YEAR for the fun lookback view.
      const wk = weekKeyOf(iso);
      if (!wk) continue;
      const b = base.get(nm) || {};
      b[wk] = (b[wk] || 0) + cv;
      base.set(nm, b);
    }
  }
  const reps = [];
  const names = new Set([...base.keys(), ...cur.keys()]);
  names.forEach(nm => {
    const weeks = base.get(nm) || {};
    let bestWk = null, bestRev = 0;
    Object.entries(weeks).forEach(([wk, rev]) => { if (rev > bestRev) { bestRev = rev; bestWk = wk; } });
    if (bestRev <= 0) return;                      // no baseline = nothing to beat
    const c = cur.get(nm) || { total: 0, byDay: {} };
    // Tier minimum targets (per Isaac): the number to beat is the rep's
    // best week FLOORED at $7K for Rookies / $10K for Vets — a small
    // baseline doesn't make a small target.
    const _min = (typeof getRepTier === 'function' && getRepTier(nm) === 'rookie') ? 7000 : 10000;
    const target = Math.max(bestRev, _min);
    reps.push({ name: nm, bestWk, bestRev, target, cur: c.total, byDay: c.byDay, earned: c.total > target });
  });
  return reps;
}

// ── Spring Cleaning scoring ────────────────────────────────────────────────
// Branch-vs-branch, six categories, golf scoring (place = points, low total
// wins). Accounts are disqualified first:
//   • Last Resort  = initial price < $99
//   • Audit        = must be flagged "pass" in Customer Flags (failed OR
//                    not-yet-audited blank both DON'T count)
// Returns per-branch metrics + category places + total points + overall place
// + bugs, plus the excluded set and an excluded-metrics summary.
const SC_PEST_EXCLUDE = /sentricon|german\s*roach|interior\s*flea/i;
// The Flags column can hold several flags at once; match the exact audit
// tokens so unrelated flags (or words like "compass"/"failed payment") can't
// trip the audit gate.
const SC_PASS_RE = /passed\s*audit/i;
const SC_FAIL_RE = /failed\s*audit/i;
// One-time services (subscription starts with "One Time …") — excluded from the
// 24+ Month % denominator since a one-time job can never be a 24-month agreement.
const SC_ONETIME_RE = /^\s*one[\s-]?time/i;
// "No Audit" = the account doesn't require auditing → treat as passed (counts).
const SC_NOAUDIT_RE = /no\s*audit/i;
const scAuditPassed = (flags) => SC_PASS_RE.test(flags || '') || SC_NOAUDIT_RE.test(flags || '');
function springCleaningHasPayment(s) {
  const v = String(s.autoPay || '').trim().toLowerCase();
  return v !== '' && v !== 'no' && v !== 'none' && v !== '0' && v !== 'n' && v !== 'false';
}
// ── Servicing deadline ─────────────────────────────────────────────────────
// Accounts sold in a round must be SERVICED (initial service completed) by the
// end of the week FOLLOWING the week they were sold (weeks Sun–Sat). Sold
// June 8 (week Jun 7–13) → serviced by Sat Jun 20. Past the deadline and still
// unserviced — or serviced after it — the account is excluded from the comp
// entirely. Before the deadline, an unserviced account is still in play. Only
// enforced once the data actually carries serviced dates, so older snapshots
// (no Serviced Date column) are unaffected and never wrongly excluded.
let _scServicingCache = { ref: null, val: false };
function _scServicingHasData() {
  const rows = state._indicatorRawSales || [];
  if (_scServicingCache.ref === rows) return _scServicingCache.val;
  const val = rows.some(r => r && String(r.servicedDate || '').trim());
  _scServicingCache = { ref: rows, val };
  return val;
}
function springServiceDeadline(s) {
  const sold = (typeof _parseIndicatorDay === 'function') ? _parseIndicatorDay(s) : null;
  if (!sold || isNaN(sold)) return null;
  const wkSun = new Date(sold); wkSun.setHours(0, 0, 0, 0);
  wkSun.setDate(wkSun.getDate() - wkSun.getDay());          // back to that week's Sunday
  const deadline = new Date(wkSun);
  deadline.setDate(deadline.getDate() + 13);                // the FOLLOWING week's Saturday
  deadline.setHours(23, 59, 59, 999);
  return deadline;
}
function _scParseServiced(raw) {
  raw = String(raw || '').trim(); if (!raw) return null;
  let d;
  if (raw.includes('/')) { const p = raw.split(' ')[0].split('/'); if (p.length === 3) { let [m, dd, y] = p.map(Number); if (y < 100) y += 2000; d = new Date(y, m - 1, dd); } }
  else d = new Date(raw.length <= 10 ? raw + 'T00:00' : raw);
  return (d && !isNaN(d)) ? d : null;
}
// 'intime' serviced on/before deadline · 'late' serviced after / past deadline
// unserviced · 'open' unserviced but deadline not reached · 'na' no data.
function springServicedStatus(s) {
  if (!_scServicingHasData()) return 'na';
  const deadline = springServiceDeadline(s);
  if (!deadline) return 'open';
  const svc = _scParseServiced(s.servicedDate);
  if (svc) return svc <= deadline ? 'intime' : 'late';
  return (new Date() > deadline) ? 'late' : 'open';
}

// ── Last Man Standing servicing deadline ───────────────────────────────────
// Tighter than Spring Cleaning's: a sale must be serviced by the FOLLOWING
// Friday after it was sold. Rounds are weekly Saturdays, so an account sold on
// a Saturday has to be serviced by the next Friday (6 days later) for its
// revenue to count that round. Past that Friday, unserviced or serviced-late
// accounts drop — so a rep can't sandbag a service date into the future to pad
// a round. Before the Friday, an unserviced account is still in play.
function lmsServiceDeadline(s) {
  const sold = (typeof _parseIndicatorDay === 'function') ? _parseIndicatorDay(s) : null;
  if (!sold || isNaN(sold)) return null;
  const dl = new Date(sold); dl.setHours(0, 0, 0, 0);
  dl.setDate(dl.getDate() + 6);              // sold Saturday + 6 = the following Friday
  dl.setHours(23, 59, 59, 999);
  return dl;
}
function lmsServicedStatus(s) {
  if (!_scServicingHasData()) return 'na';    // older snapshots without serviced dates — don't penalize
  const deadline = lmsServiceDeadline(s);
  if (!deadline) return 'open';
  const svc = _scParseServiced(s.servicedDate);
  if (svc) return svc <= deadline ? 'intime' : 'late';
  return (new Date() > deadline) ? 'late' : 'open';
}

// Is the "initial status" field present in the current dataset? (Older
// snapshots synced before we pulled it won't have it — then we fall back to the
// cancel-date heuristic so we never wrongly exclude real pending accounts.)
let _scInitStatusCache = { ref: null, val: false };
function _scInitialStatusHasData() {
  const rows = state._indicatorRawSales || [];
  if (_scInitStatusCache.ref === rows) return _scInitStatusCache.val;
  const val = rows.some(r => r && String(r.initialStatus || '').trim());
  _scInitStatusCache = { ref: rows, val };
  return val;
}
// "Sold Not Started" — sold but no real service is happening: closed on the
// sales-rep side (cancelled at the door, no contract), frozen, no initial
// appointment, or the initial appt was cancelled/no-showed. These never need an
// audit, so they're out of the comp entirely. An account is REAL production
// (not SNS) only if it's been serviced OR it's Active with a Pending initial
// appointment. (Post-service cancels — serviced, then cancelled — still count.)
function _scIsSoldNotStarted(s) {
  const serviced = (Number(s.services) || 0) > 0 || !!_scParseServiced(s.servicedDate);
  if (serviced) return false;                                   // already serviced → real production
  if (!_scInitialStatusHasData()) {
    // No initial-status in this snapshot — fall back to cancel-date detection
    // (cancelled before any service = SNS).
    return !!String(s.cancelDate || '').trim();
  }
  const status = String(s.status || s.active || '').trim().toLowerCase();
  const init   = String(s.initialStatus || '').trim().toLowerCase();
  return !(status === 'active' && init === 'pending');          // only Active + Pending appt counts
}

// Three-way bucket per account:
//   'excluded' — Last Resort (<$99), Sold-Not-Started, Failed audit, or not
//                serviced by the deadline
//   'pending'  — passes the $99 floor but audit flag is neither pass nor fail
//                (still being audited; revenue "out there" waiting to clear)
//   'counting' — clears the floor AND is flagged pass
function springCleaningStatus(s) {
  if ((Number(s.initialPrice) || 0) < 99) return 'excluded';
  if (!frPendingServiced(s)) return 'excluded';                 // FR Pending/Serviced gate — same base as the CRM report
  if (springServicedStatus(s) === 'late') return 'excluded';    // not serviced by the deadline
  if (scAuditPassed(s.customerFlags)) return 'counting';        // Passed Audit OR No Audit
  if (SC_FAIL_RE.test(s.customerFlags || '')) return 'excluded';
  return 'pending';
}

function springCleaningCompute(sales, branchList) {
  // Branch eligibility — branches can sit a comp out entirely (Salt Lake
  // isn't competing this year, which is the seeded default). Stored on the
  // competition itself (comp.excludedBranches, uppercase office names) and
  // editable via the "Competing" chips on the board, so the admin controls
  // who counts — excluded branches affect NO category, points, or audit %.
  const _scComp = (typeof getActiveComp === 'function') ? getActiveComp() : null;
  if (_scComp && !Array.isArray(_scComp.excludedBranches)) _scComp.excludedBranches = ['SALT LAKE'];
  // Rep market overrides — a rep knocking in one market can be reassigned
  // to ANOTHER branch for comp purposes (👥 Reps button on the board).
  // All of their sales count under the assigned branch in every category,
  // PRA denominator, and Audit %. Applied BEFORE the excluded-branch
  // filter so a reassignment in/out of an excluded branch behaves right.
  const _scOv = (_scComp && _scComp.repBranchOverrides && typeof _scComp.repBranchOverrides === 'object') ? _scComp.repBranchOverrides : {};
  if (Object.keys(_scOv).length > 0) {
    sales = (sales || []).map(s => {
      const ov = _scOv[_cleanRepName(getCanonicalRepName(s.rep || ''))];
      return (ov && ov !== s.office) ? { ...s, office: ov } : s;
    });
  }
  const _scExB = new Set((_scComp?.excludedBranches || ['SALT LAKE']).map(b => String(b).toUpperCase()));
  sales = (sales || []).filter(s => !_scExB.has((s.office || '').toUpperCase()));
  branchList = (branchList || []).filter(b => !_scExB.has(String(b).toUpperCase()));
  // Who competes: the SALES REP rep type only (Office Staff / Technicians are
  // out entirely — they don't even land in pending/excluded). Rep type comes
  // from the Customer Report cross-reference, falling back to Source only for
  // reps with no type on file.
  // Sold-Not-Started accounts (no service and not active+pending — closed at
  // the door, frozen, no appointment, etc.) are dropped here, up front, so they
  // touch NO metric — not revenue, not Audit %, not PRA. They never needed an audit.
  const d2dSales = sales.filter(s => _indicatorDeptOf(s) === 'd2d' && frPendingServiced(s));
  const counting = [], pending = [], excluded = [];
  for (const s of d2dSales) {
    const st = springCleaningStatus(s);
    if (st === 'counting') counting.push(s);
    else if (st === 'pending') pending.push(s);
    else excluded.push(s);
  }

  // PRA denominator = every D2D rep with at least one NON-Last-Resort sale
  // in the branch/window. Last Resort (<$99 initial) accounts leave NO
  // footprint on PRA — they don't add revenue and a rep whose only sales
  // are Last Resorts doesn't dilute the per-rep average either. (Failed
  // audit / pending sales still count the rep — those are real production.)
  const branchReps = new Map(); // office → Set(rep)
  for (const s of d2dSales) {
    if ((Number(s.initialPrice) || 0) < 99) continue; // Last Resort — no PRA footprint
    const b = s.office || 'UNKNOWN';
    if (!branchReps.has(b)) branchReps.set(b, new Set());
    if (s.rep) branchReps.get(b).add(s.rep);
  }

  // Passed Audit % — measured across every Sales-Rep account in the branch (no
  // $99 floor, no last-resort or failed exclusion in the denominator); only
  // pre-service cancels are already gone. Numerator = accounts NOT flagged
  // Failed Audit (passed, no-audit, and pending all count). Last Resort
  // accounts count by their actual flag, pass or fail.
  const auditTally = new Map(); // office → { tot, fail }
  for (const s of d2dSales) {
    const b = s.office || 'UNKNOWN';
    if (!auditTally.has(b)) auditTally.set(b, { tot: 0, fail: 0 });
    const t = auditTally.get(b);
    t.tot += 1;
    if (SC_FAIL_RE.test(s.customerFlags || '')) t.fail += 1;
  }
  // Revenue breakdown columns (informational): Passed Rev (scored = counting +
  // pending) + Failed Rev (everything NOT counting — failed audit, Last Resort,
  // and not-serviced-by-deadline) = Total Rev, so Total = Passed + Failed ties
  // out. Pending Rev is the un-flagged subset of Passed, shown so teams can
  // watch it clear as audits land.
  const pendingRevByBranch = new Map(), notCountingRevByBranch = new Map();
  for (const s of pending)  { const b = s.office || 'UNKNOWN'; pendingRevByBranch.set(b, (pendingRevByBranch.get(b) || 0) + (Number(s.contractValue) || 0)); }
  for (const s of excluded) { const b = s.office || 'UNKNOWN'; notCountingRevByBranch.set(b, (notCountingRevByBranch.get(b) || 0) + (Number(s.contractValue) || 0)); }

  // Standings count BOTH passed-audit AND pending accounts — we assume a
  // pending account will pass until it's flagged Failed Audit. (Excluded =
  // failed audit or Last Resort, which never count toward revenue/categories.)
  const scored = counting.concat(pending);
  const seed = (office) => ({ office, revenue: 0, n: 0, pestSum: 0, pestCnt: 0, cvSum: 0, cnt24: 0, n24denom: 0, cntAuto: 0 });
  const byBranch = new Map();
  const branches = (branchList && branchList.length)
    ? branchList.slice()
    : [...new Set(d2dSales.map(s => s.office).filter(Boolean))];
  branches.forEach(b => byBranch.set(b, seed(b)));
  for (const s of scored) {
    const b = s.office || 'UNKNOWN';
    if (!byBranch.has(b)) { byBranch.set(b, seed(b)); branches.push(b); }
    const m = byBranch.get(b);
    m.revenue += Number(s.contractValue) || 0;
    m.n += 1;
    if (!SC_PEST_EXCLUDE.test(s.subscription || '')) { m.pestSum += Number(s.initialPrice) || 0; m.pestCnt += 1; }
    m.cvSum += Number(s.contractValue) || 0;
    // 24+ Mo %: one-time services are excluded from the denominator (they can't
    // carry a 24-month agreement). Everything else counts in the denominator.
    if (!SC_ONETIME_RE.test(s.subscription || '')) m.n24denom += 1;
    if ((Number(s.contract) || 0) >= 24) m.cnt24 += 1;
    if (springCleaningHasPayment(s)) m.cntAuto += 1;
  }

  const metrics = branches.map(b => {
    const m = byBranch.get(b);
    const reps = (branchReps.get(b) || new Set()).size;
    const at = auditTally.get(b) || { tot: 0, fail: 0 };
    const failedRev = notCountingRevByBranch.get(b) || 0;
    return {
      office: b, reps, n: m.n,
      revenue:        m.revenue,                         // PASSED Rev — scored (passed + no-audit + pending)
      pendingRevenue: pendingRevByBranch.get(b) || 0,    // pending subset of Passed (informational)
      failedRevenue:  failedRev,                         // NOT-counting rev (failed + last resort + not-serviced)
      totalRevenue:   m.revenue + failedRev,             // Total = Passed + Failed (reconciles)
      pra:            reps > 0 ? m.revenue / reps : 0,
      avgPestInitial: m.pestCnt > 0 ? m.pestSum / m.pestCnt : 0,
      acv:            m.n > 0 ? m.cvSum / m.n : 0,
      pct24:          m.n24denom > 0 ? m.cnt24 / m.n24denom : 0,
      autopayPct:     m.n > 0 ? m.cntAuto / m.n : 0,
      auditPct:       at.tot > 0 ? (at.tot - at.fail) / at.tot : 0,
      auditTot:       at.tot,
    };
  });

  // Rank each category (higher value = better = lower place number).
  // Competition ("1-2-2-4") ranking: a DEAD tie shares the same points and
  // the next place is skipped — two teams at 100% AutoPay both take 1pt
  // and the next team gets 3. (Values rounded to 6dp so float noise can't
  // fake or break a tie.)
  const CATS = ['revenue', 'pra', 'avgPestInitial', 'acv', 'pct24', 'autopayPct', 'auditPct'];
  const places = {};
  const _rkey = (v) => Math.round((Number(v) || 0) * 1e6) / 1e6;
  for (const cat of CATS) {
    const sorted = [...metrics].sort((a, b) =>
      (_rkey(b[cat]) - _rkey(a[cat])) || a.office.localeCompare(b.office));
    let prevVal = null, prevPlace = 0;
    sorted.forEach((m, i) => {
      const v = _rkey(m[cat]);
      const place = (prevVal !== null && v === prevVal) ? prevPlace : i + 1;
      prevVal = v; prevPlace = place;
      (places[m.office] = places[m.office] || {})[cat] = place;
    });
  }
  metrics.forEach(m => {
    m.places = places[m.office];
    m.totalPoints = CATS.reduce((sum, c) => sum + (m.places[c] || 0), 0);
  });

  // Overall placement: lowest total points wins; TOTAL ties are broken by
  // higher Passed Audit % (per the comp rules — Avg Pest Initial is the
  // tiebreaker only WITHIN individual categories, handled in the CATS
  // ranking above).
  const ranked = [...metrics].sort((a, b) =>
    (a.totalPoints - b.totalPoints) || (b.auditPct - a.auditPct) || (b.avgPestInitial - a.avgPestInitial) || a.office.localeCompare(b.office));
  ranked.forEach((m, i) => {
    m.place = i + 1;
    m.bugs = Math.max(0, 7 - m.place); // fixed 7-place scale: 1st→6 … 7th→0
  });

  // Summaries — "how much revenue isn't counting" (excluded) and "still out
  // there" (pending audit).
  const sumRev  = (arr) => arr.reduce((s, r) => s + (Number(r.contractValue) || 0), 0);
  const sumInit = (arr) => arr.reduce((s, r) => s + (Number(r.initialPrice) || 0), 0);
  const excludedSummary = {
    count: excluded.length,
    revenue: sumRev(excluded),
    avgInitial: excluded.length ? sumInit(excluded) / excluded.length : 0,
    lastResort:  excluded.filter(s => (Number(s.initialPrice) || 0) < 99).length,
    failedAudit: excluded.filter(s => (Number(s.initialPrice) || 0) >= 99 && SC_FAIL_RE.test(s.customerFlags || '')).length,
  };
  const pendingSummary = {
    count: pending.length,
    revenue: sumRev(pending),
    avgInitial: pending.length ? sumInit(pending) / pending.length : 0,
  };

  return { ranked, scored, counting, pending, excluded, excludedSummary, pendingSummary, categories: CATS };
}

// Revenue is split by audit status, mirroring Spring Cleaning:
//   passed  — Passed Audit OR No Audit
//   failed  — Failed Audit OR Last Resort (initial < $99 or a "Last Resort" flag)
//   pending — no pass/fail flag yet
// Last Resort / Failed take precedence over a pass flag. Total = the sum of
// everything (passed + pending + failed); reps are ranked on Passed revenue.
const TG_LASTRESORT_RE = /last\s*resort/i;
function topGunBucket(s) {
  const lastResort = (Number(s.initialPrice) || 0) < 99 || TG_LASTRESORT_RE.test(s.customerFlags || '');
  if (lastResort || SC_FAIL_RE.test(s.customerFlags || '')) return 'failed';
  if (scAuditPassed(s.customerFlags)) return 'passed';
  return 'pending';
}

function topGunCompute(windowedSales, proSet) {
  proSet = proSet || new Set();
  const byRep = new Map();
  const ensure = (rep) => { if (!byRep.has(rep)) byRep.set(rep, { rep, passedRev: 0, failedRev: 0, pendingRev: 0, passedCount: 0, pendingCount: 0, accounts: 0, failedAudit: 0 }); return byRep.get(rep); };
  for (const s of (windowedSales || [])) {
    const m = ensure(s.rep || 'Unknown');
    const cv = Number(s.contractValue) || 0;
    const b = topGunBucket(s);
    if (b === 'passed') { m.passedRev += cv; m.passedCount += 1; }
    else if (b === 'failed') m.failedRev += cv;
    else { m.pendingRev += cv; m.pendingCount += 1; }
    // Audit % (same as Spring Cleaning): numerator = NOT flagged Failed Audit
    // (passed + no-audit + pending all count); denominator = every account
    // incl. failed audit & last resort. Last resort counts by its real flag.
    if (SC_FAIL_RE.test(s.customerFlags || '')) m.failedAudit += 1;
    m.accounts += 1;
  }
  proSet.forEach(rep => ensure(rep)); // Pros always appear, even with no window sales
  // Reps are ranked on Passed revenue (audit-passed production). Total is just
  // the sum of everything (passed + pending + failed), shown as the lead column.
  const byPassed = (a, b) => b.passedRev - a.passedRev || b.total - a.total;
  const all = [...byRep.values()].map(m => ({
    ...m,
    total: m.passedRev + m.pendingRev + m.failedRev,
    subs: m.accounts,                                           // all subscriptions sold (every account, all audit statuses)
    acv: m.accounts > 0 ? (m.passedRev + m.pendingRev + m.failedRev) / m.accounts : 0, // ACV across ALL accounts
    auditPct: m.accounts > 0 ? (m.accounts - m.failedAudit) / m.accounts : 0,
  }));
  const pro = all.filter(m => proSet.has(m.rep)).sort(byPassed);
  const rest = all.filter(m => !proSet.has(m.rep) && (m.total > 0 || m.failedRev > 0));
  const rookie = rest.filter(m => getRepTier(m.rep) === 'rookie').sort(byPassed);
  const vet    = rest.filter(m => getRepTier(m.rep) === 'vet').sort(byPassed);
  const none   = rest.filter(m => { const t = getRepTier(m.rep); return t !== 'rookie' && t !== 'vet'; }).sort(byPassed);
  return { rookie, vet, pro, none };
}

// ── Tier resolution — YEAR-AWARE so tags never need redoing in January ──
// Sales history drives the DEFAULT: a rep whose first sale year is the
// current year reads Rookie; anyone with prior-year sales reads Vet; no
// sales = untagged. Manual tags override:
//   · 'vet' is forever — vets never demote.
//   · 'rookie' applies to the year it was tagged (_indicatorRepTierYear);
//     when that rep returns the next season they auto-promote to Vet.
let _tierYearsCache = { src: null, map: null };
function _repSaleYears(repName) {
  const src = state._indicatorRawSales || [];
  const _sig = (n) => String(n || '').toLowerCase().replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean).sort().join(' ');
  if (_tierYearsCache.src !== src) {
    const m = new Map();
    let latestMs = 0;
    for (const x of src) {
      if (!x || !x.rep) continue;
      const iso = (typeof dateSoldToIso === 'function') ? dateSoldToIso(x.dateSold) : '';
      const y = Number(String(iso).slice(0, 4));
      if (!y) continue;
      const ms = Date.parse(iso + 'T00:00') || 0;
      // Anchor ignores garbage FUTURE sold-dates (a single CRM typo like a
      // 2027 date was flipping the whole roster auto-inactive — per Isaac's
      // blank Kobe board). Real rows are never more than ~2 days ahead.
      if (ms > latestMs && ms <= Date.now() + 2 * 86400000) latestMs = ms;
      const k = _sig(getCanonicalRepName(x.rep));
      const e = m.get(k);
      if (!e) m.set(k, { min: y, max: y, lastMs: ms });
      else { if (y < e.min) e.min = y; if (y > e.max) e.max = y; if (ms > e.lastMs) e.lastMs = ms; }
    }
    _tierYearsCache = { src, map: m, latestMs };
  }
  return _tierYearsCache.map.get(_sig(getCanonicalRepName(repName))) || null;
}
function getRepTier(repName) {
  if (!repName) return '';
  const tagged = _repKeyedLookup(state._indicatorRepTier || {}, repName);
  const curY = new Date().getFullYear();
  if (tagged === 'vet') return 'vet';
  if (tagged === 'rookie') {
    const ty = Number(_repKeyedLookup(state._indicatorRepTierYear || {}, repName)) || 0;
    if (ty >= curY) return 'rookie';                       // tagged rookie THIS season — respected
    if (ty && ty < curY) return 'vet';                     // returning rookie → auto-promoted
    // Legacy tag with no recorded year — trust the sales history.
    const yrs = _repSaleYears(repName);
    return (yrs && yrs.min < curY) ? 'vet' : 'rookie';
  }
  if (tagged) return tagged;
  // Untagged → sales-history default (no manual work needed).
  const yrs = _repSaleYears(repName);
  if (!yrs) return '';
  return yrs.min < curY ? 'vet' : 'rookie';
}

const _canonNameCache = new Map();
let _canonNameCacheRev = -1;
function getCanonicalRepName(name) {
  if (!name) return name;
  // Memoized — the two regex replaces allocated on EVERY call, and this runs
  // per row in every 100k-row loop. Cache keys on the raw string; alias
  // merges bump _indCfgRev (via saveIndicatorState) which clears it.
  const rev = (typeof _indCfgRev !== 'undefined') ? _indCfgRev : 0;
  if (_canonNameCacheRev !== rev) { _canonNameCache.clear(); _canonNameCacheRev = rev; }
  const hit = _canonNameCache.get(name);
  if (hit !== undefined) return hit;
  // FieldRoutes sometimes exports doubled spaces ("Karson  Murray") or stray
  // comma spacing ("Sabbach , Jacob") — collapse whitespace and normalize
  // commas to ", " so the same human can't split into two reps, and team/
  // tier lookups keyed on the clean spelling still match.
  const clean = String(name).replace(/\s+/g, ' ').replace(/\s*,\s*/g, ', ').trim();
  const aliases = state._indicatorRepAlias || {};
  const out = aliases[clean] || aliases[name] || clean;
  _canonNameCache.set(name, out);
  return out;
}
