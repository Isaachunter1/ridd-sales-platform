// ┌─ src/67-tv-board.js ──────────────────────────────────────────────────────
// │ TV Display — the inside-sales floor board (gear menu → TV Display).
// │ Rebuilt Sep 2026 on Cam's RIDDMADE design kit: Deck 2.0 palette (a
// │ lit screen, not paper), Anton headlines, every figure in the mono,
// │ ember spent once — on the number. Same CRM-backed pool as the War Room.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ── Live feed (per Isaac, Oct 14: "move the tv display to the 15 minute pull —
// as live as possible"). The FieldRoutes live pull publishes every
// subscription added in the last two days to app_settings.crm_live_recent, in
// the Indicators feed's raw-row shape. Merged over the RevHawk dataset for the
// board only: a sale the dataset already has gets the live status / amounts /
// autopay; one it doesn't have yet (sold minutes ago) is added. Everything
// downstream (Pending/Serviced gate, excluded sources and services, the rep
// bridge) runs exactly as it does for the dataset's own rows.
// Signed agreement data is paused on the TV until FieldRoutes' signed-contract endpoint is in (see signedOf).
const TV_SIGNED_PAUSED = true;
let _tvLiveMergeCache = { base: null, live: null, out: null };
function tvRawWithLive() {
  const base = state._indicatorRawSales || [];
  const live = state._crmLiveRecent && Array.isArray(state._crmLiveRecent.rows) ? state._crmLiveRecent.rows : null;
  if (!live || !live.length || !base.length) return base;
  if (_tvLiveMergeCache.base === base && _tvLiveMergeCache.live === live) return _tvLiveMergeCache.out;
  const toIso = (d) => (typeof dateSoldToIso === 'function' && dateSoldToIso(d)) || String(d || '').slice(0, 10);
  const day = (r) => String(r.customerId != null ? r.customerId : '') + '|' + toIso(r.dateSold);
  const svc = (r) => String(r.subscription || '').trim().toLowerCase();
  // The live pull lists EVERY subscription added in its window, so for a
  // customer + day it has, its rows are the truth: the dataset's rows for that
  // customer + day are replaced one-for-one (per Isaac, Oct 14 — #184028 showed
  // twice after its plan was changed from Pest Mosquito 4 Seasonal to Pest 4:
  // the dataset still had the old service, the live pull the new one).
  const liveByDay = new Map();
  live.forEach(lv => { const k = day(lv); (liveByDay.get(k) || liveByDay.set(k, []).get(k)).push(lv); });
  const FRESH = ['subscription', 'active', 'status', 'initialStatus', 'autoPay', 'contractValue', 'initialPrice', 'contract', 'recurring', 'source', 'cancelDate'];
  const baseByDay = new Map();
  const out = [];
  base.forEach(r => { const k = day(r); if (liveByDay.has(k)) (baseByDay.get(k) || baseByDay.set(k, []).get(k)).push(r); else out.push(r); });
  for (const [k, lvs] of liveByDay) {
    const pool = (baseByDay.get(k) || []).slice();
    // Same service first, then whatever dataset row is left for that customer + day.
    const pair = new Map();
    lvs.forEach(lv => { const i = pool.findIndex(r => svc(r) === svc(lv)); if (i >= 0) pair.set(lv, pool.splice(i, 1)[0]); });
    lvs.forEach(lv => { if (!pair.has(lv) && pool.length) pair.set(lv, pool.shift()); });
    for (const lv of lvs) {
      const r = pair.get(lv);
      if (r) {
        const o = Object.assign({}, r);
        FRESH.forEach(f => { if (lv[f] != null && lv[f] !== '') o[f] = lv[f]; });
        o.services = Math.max(Number(r.services) || 0, Number(lv.services) || 0);
        out.push(o);
      } else {
        const office = (typeof branchAlias === 'function') ? branchAlias(lv.office) : lv.office;
        out.push(Object.assign({ customer: '', cancelReason: '', customerFlags: '', servicedDate: '', age: 0 }, lv, { office, _live: true }));
      }
    }
  }
  _tvLiveMergeCache = { base, live, out };
  return out;
}

function openTvBoard() {
  // Desktop only (per Isaac): the board is a wall display, never a phone view.
  try { if (window.matchMedia('(max-width: 900px)').matches) { if (typeof toast === 'function') toast('TV Display is desktop-only \u2014 open it on a computer.', 'info'); return; } } catch (e) { /* noop */ }
  state._tvOpen = true;   // the version watcher auto-reloads while this is set
  try { localStorage.setItem('ridd_tv_board', '1'); } catch (e) { /* private */ }   // any reload (deploy, crash, power blip) lands back on the board
  // Deck 2.0 tokens (docs/design-kit/BRAND.md) — scoped to the board.
  const T = { void: '#0A0B0D', surface: '#14161A', surface2: '#1E2128', hair: '#2B2F38', ink: '#F4F6F8', dim: '#9AA2B1', ember: '#FF5F2E' };
  const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
  const HEAD = "'Anton', 'Archivo', ui-sans-serif, system-ui, sans-serif";
  const VOICE = "'Archivo', ui-sans-serif, system-ui, sans-serif";
  const EXCLUDED = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  // Same ranges as the main dashboard's date filter (per Isaac, Oct 14) — every
  // preset plus each year in the data; Custom is left off (a wall board has no
  // date picker). Old saved values (week / month / year) map to the new ids.
  { const _old = { week: 'this_week', month: 'this_month', year: 'this_year' }; if (_old[state._tvRange]) state._tvRange = _old[state._tvRange]; }
  const RANGES = ((typeof indicatorPresetOptions === 'function') ? indicatorPresetOptions() : [{ id: 'today', label: 'Today' }, { id: 'this_week', label: 'This Week' }, { id: 'this_month', label: 'This Month' }, { id: 'this_year', label: 'This Year' }])
    .filter(o => !['custom', 'all_time', 'last_year'].includes(o.id)).map(o => [o.id, o.label]);   // All time + Last year off the board (per Isaac, Oct 14)
  if (!RANGES.some(r => r[0] === state._tvRange)) state._tvRange = 'today';
  const _KEY_RANGES = ['today', 'this_week', 'this_month', 'this_year'];   // keys 1–4, as before

  const overlay = el('div', { style: { position: 'fixed', inset: '0', background: T.void, color: T.ink, zIndex: '9999', overflow: 'hidden', fontFamily: VOICE } });
  let timers = [];
  let lastKeys = null;   // sale ids seen on the previous paint → pulse on a new one
  let rtSub = null;      // Supabase realtime channel on `sales` (per Isaac, Sep 22: the board reacts the moment a row lands)
  const cleanup = () => {
    state._tvOpen = false;
    try { localStorage.removeItem('ridd_tv_board'); } catch (e) { /* private */ }
    timers.forEach(clearInterval); timers = [];
    if (rtSub) { try { supabase.removeChannel(rtSub); } catch (e) { /* already gone */ } rtSub = null; }
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    document.querySelectorAll('[data-tv-drill]').forEach(n => n.remove());
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { if (!document.fullscreenElement) cleanup(); return; }
    if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') { state._tvRange = _KEY_RANGES[Number(e.key) - 1]; render(); }
    if (e.key === 'f' || e.key === 'F') toggleFs();
    // R: take a waiting build now (deploys otherwise land on the board overnight).
    if (e.key === 'r' || e.key === 'R') { try { sessionStorage.setItem('ridd_reopen_tv', '1'); } catch { /* private */ } location.reload(); }
  };
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else overlay.requestFullscreen?.().catch(() => {}); };
  // (listeners are attached after render() exists — a const can't be
  // referenced before its line, which is what made the first cut a no-op.)
  const onFs = () => { try { render(); } catch (e) { /* keep the board up */ } };

  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const localDay = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : iso(d); };
  const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const pct = (n) => (Math.round((n || 0) * 10) / 10).toFixed(1) + '%';
  const BOARD_TZ = 'America/Denver';   // the room's clock (per Isaac): every time on the board reads Mountain
  // One-time service? CRM rows: not Sentricon and no multi-month term; app rows: contract types 4/5.
  const isOts = (s) => s._crm ? (!/sentricon/i.test(String(s._crmService || '')) && !(Number(s.contract_months) > 1)) : new Set([4, 5]).has(Number(s.contract_type_id));
  const isSellingDay = (d) => { const w = d.getDay(); if (w === 0 || w === 6) return false; return !(typeof companyHolidayFor === 'function' && companyHolidayFor(iso(d))); };

  // Every window on the board's LOCAL calendar (an evening sale stays on its
  // own day). Current periods run to today; past ones are whole periods.
  const _d = (y, m, dd) => new Date(y, m, dd);
  const rangeOf = () => {
    const now = new Date(); const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate(); const today = iso(now);
    const id = state._tvRange; const lbl = (RANGES.find(r => r[0] === id) || [id, 'Today'])[1];
    const ym = /^year:(\d{4})$/.exec(id || '');
    if (ym) return { start: ym[1] + '-01-01', end: ym[1] + '-12-31', label: ym[1] };
    switch (id) {
      case 'yesterday':  { const y = _d(Y, M, D - 1); return { start: iso(y), end: iso(y), label: 'Yesterday' }; }
      case 'this_week':  return { start: iso(_d(Y, M, D - now.getDay())), end: today, label: 'This week' };   // Sunday → today (Sun–Sat weeks)
      case 'last_week':  return { start: iso(_d(Y, M, D - now.getDay() - 7)), end: iso(_d(Y, M, D - now.getDay() - 1)), label: 'Last week' };
      case 'this_month': return { start: iso(_d(Y, M, 1)), end: today, label: now.toLocaleDateString('en-US', { month: 'long' }) };
      case 'last_month': return { start: iso(_d(Y, M - 1, 1)), end: iso(_d(Y, M, 0)), label: _d(Y, M - 1, 1).toLocaleDateString('en-US', { month: 'long' }) };
      case 'this_year':  return { start: Y + '-01-01', end: today, label: String(Y) };
      case 'last_year':  return { start: (Y - 1) + '-01-01', end: (Y - 1) + '-12-31', label: String(Y - 1) };
      case 'all_time':   return { start: '2000-01-01', end: today, label: 'All time' };
      default:           return { start: today, end: today, label: lbl === 'Today' ? 'Today' : lbl };
    }
  };
  // The comparable PRIOR period (per Isaac): current periods compare to the
  // prior period TO DATE (fair mid-period); whole past periods to the whole
  // period before. All time has nothing to compare against.
  const priorRangeOf = () => {
    const now = new Date(); const Y = now.getFullYear(), M = now.getMonth(), D = now.getDate();
    const id = state._tvRange;
    const ym = /^year:(\d{4})$/.exec(id || '');
    if (ym) { const y = Number(ym[1]) - 1; return { start: y + '-01-01', end: y + '-12-31', label: String(y) }; }
    switch (id) {
      case 'yesterday':  { const y = _d(Y, M, D - 2); return { start: iso(y), end: iso(y), label: 'Day before' }; }
      case 'this_week':  return { start: iso(_d(Y, M, D - now.getDay() - 7)), end: iso(_d(Y, M, D - 7)), label: 'Last week to date' };
      case 'last_week':  return { start: iso(_d(Y, M, D - now.getDay() - 14)), end: iso(_d(Y, M, D - now.getDay() - 8)), label: 'Week before' };
      case 'this_month': { const e = _d(Y, M - 1, Math.min(D, _d(Y, M, 0).getDate())); return { start: iso(_d(Y, M - 1, 1)), end: iso(e), label: e.toLocaleDateString('en-US', { month: 'long' }) + ' to date' }; }
      case 'last_month': return { start: iso(_d(Y, M - 2, 1)), end: iso(_d(Y, M - 1, 0)), label: _d(Y, M - 2, 1).toLocaleDateString('en-US', { month: 'long' }) };
      case 'this_year':  { const e = _d(Y - 1, M, D); return { start: (Y - 1) + '-01-01', end: iso(e), label: (Y - 1) + ' to date' }; }
      case 'last_year':  return { start: (Y - 2) + '-01-01', end: (Y - 2) + '-12-31', label: String(Y - 2) };
      case 'all_time':   return { start: '9999-01-01', end: '9999-01-01', label: 'No prior period' };
      default:           { const y = _d(Y, M, D - 1); return { start: iso(y), end: iso(y), label: 'Yesterday' }; }
    }
  };
  // Goal for the window: the Goals tab's monthly allocation (new + renewal,
  // else the annual spread evenly) over the month's selling days.
  const goalFor = (range) => {
    const g = state.companyGoal || {};
    const monthTarget = (mi) => {
      const mn = Array.isArray(g.monthly_new) && g.monthly_new.length === 12 ? Number(g.monthly_new[mi]) || 0 : 0;
      const mr = Array.isArray(g.monthly_renewal) && g.monthly_renewal.length === 12 ? Number(g.monthly_renewal[mi]) || 0 : 0;
      // The hero number is NEW revenue (per Isaac), so the goal is the new
      // line only; the renewal line stays out of both sides of the bar.
      if (mn > 0) return mn;
      if (mn + mr > 0) return mn + mr;
      const annual = Number(g.amount) || 0;
      return g.period === 'year' ? annual / 12 : annual;
    };
    let total = 0;
    const d = new Date(range.start + 'T00:00'), end = new Date(range.end + 'T00:00');
    const cache = {};
    while (d <= end) {
      const key = d.getFullYear() + '-' + d.getMonth();
      if (!cache[key]) { let n = 0; const dim = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); for (let i = 1; i <= dim; i++) if (isSellingDay(new Date(d.getFullYear(), d.getMonth(), i))) n++; cache[key] = { per: monthTarget(d.getMonth()) / Math.max(1, n) }; }
      if (isSellingDay(d)) total += cache[key].per;
      d.setDate(d.getDate() + 1);
    }
    return total;
  };

  // ── Sale time (per Isaac, Sep 2026): created_at is only when the SYNC
  // wrote the row, so 'latest' was sync order and the clock was wrong. The
  // CRM snapshot carries sold_at = FieldRoutes' dateAdded on the office's
  // own clock; map it by subscription id, shift office-local → real instant
  // with the branch zone, and everything (order, clock, 'ago') is truthful.
  const _snapBySub = (() => { const m = new Map(); for (const r of (state.reportingSubscriptions || [])) { if (r.subscription_id != null && r.sold_at) m.set(String(r.subscription_id), r); } return m; })();
  const _tzOfOffice = (name) => { const k = String(name || '').toUpperCase().trim(); const cfg = state.nrlaConfig; return (typeof nrlaBranchTzOf === 'function') ? nrlaBranchTzOf(cfg, k) : ((typeof NRLA_BRANCH_TZ !== 'undefined' && NRLA_BRANCH_TZ[k]) || 'America/New_York'); };
  // Office-local wall clock "YYYY-MM-DD HH:MM:SS" in `tz` → Date. Two passes
  // of Intl to find the zone offset at that moment (handles DST).
  const _localToDate = (str, tz) => {
    const m = String(str || '').match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/); if (!m) return null;
    const asUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +(m[6] || 0));
    const offAt = (ms) => { try { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(ms)); const g = (t) => +p.find(x => x.type === t).value; return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour') % 24, g('minute'), g('second')) - ms; } catch { return 0; } };
    let ms = asUtc - offAt(asUtc); ms = asUtc - offAt(ms);
    return new Date(ms);
  };
  // FieldRoutes stamps dateAdded on the COMPANY clock, whichever office the
  // account belongs to — and RIDD's company clock is UTC−7 year-round
  // (Mountain STANDARD, no DST — the same +1/+2/+3 raw offsets the
  // Indicators feed has always applied). Verified Sep 18 2026 against the
  // RevHawk mirror, which lands every 15 min: dateAdded + 7 h is always a
  // few minutes before the row's insert time. So: Phoenix in, Mountain out.
  const CRM_TZ = 'America/Phoenix';
  // The Indicators feed's CRM rows carry created_at as a naive wall clock
  // already shifted to the OFFICE's zone (raw + _saleHourOffset) — undo the
  // shift, then read it as the raw UTC−7 clock.
  const _crmCreatedAt = (s) => {
    const m = String(s.created_at || '').match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/); if (!m) return null;
    const off = (typeof _saleHourOffset === 'function') ? _saleHourOffset(s._crmOffice || '') : 1;
    return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]) - off * 3600000 + 7 * 3600000);
  };
  const saleAt = (s) => {
    const snap = s.crm_subscription_id != null ? _snapBySub.get(String(s.crm_subscription_id)) : null;
    if (snap) { const d = _localToDate(snap.sold_at, CRM_TZ); if (d && !isNaN(d)) return d; }
    if (s._crm) { const d = _crmCreatedAt(s); if (d && !isNaN(d)) return d; }
    const c = s.created_at ? new Date(s.created_at) : null; return c && !isNaN(c) ? c : null;
  };
  const saleKey = (s) => { const d = saleAt(s); return d ? d.getTime() : 0; };
  const sourceOf = (s) => {
    const byId = s.source_id != null ? (state.sources || []).find(o => o.id === s.source_id) : null; if (byId && byId.name) return byId.name;
    const snap = s.crm_subscription_id != null ? _snapBySub.get(String(s.crm_subscription_id)) : null; if (snap && snap.subscription_source) return snap.subscription_source;
    return s.source || s._crmSource || '';
  };

  const compute = () => {
    const range = rangeOf();
    // The board's pool runs on the dataset + the live pull (tvRawWithLive above).
    let pool;
    { const keep = state._indicatorRawSales, merged = tvRawWithLive();
      if (merged !== keep) state._indicatorRawSales = merged;
      try { pool = (typeof dashboardSales === 'function' ? dashboardSales() : (state.allSales || [])) || []; }
      finally { if (merged !== keep && state._indicatorRawSales === merged) state._indicatorRawSales = keep; } }
    // Only subscriptions with an initial appointment ON THE BOOKS (per Isaac,
    // Sep 22): crm_initial_status Pending or Completed, as the sync stamps it.
    // 'None' / cancelled initials stay off the board until FieldRoutes has an
    // appointment. Rows without the stamp (manual / legacy) still show.
    const hasAppt = (s) => (typeof saleHasAppt === 'function') ? saleHasAppt(s) : true;   // shared with dashboardSales() so both boards agree
    const rows = pool.filter(s => { if (EXCLUDED.has(s.audit_status)) return false; if (!hasAppt(s)) return false; const day = localDay(s.created_at) || s.sold_date; return day && day >= range.start && day <= range.end; });
    const rev = (xs) => xs.reduce((a, s) => a + (Number(s.revenue_amount) || 0), 0);
    // New vs renewal (per Isaac): the four Renewal sources are renewal
    // revenue; the headline is everything else.
    const isRenewal = (s) => (typeof reportingSourceClass === 'function' ? reportingSourceClass(sourceOf(s)) : (/^renewal\s*-/i.test(sourceOf(s)) ? 'renewal' : 'new')) === 'renewal';
    const renewRows = rows.filter(isRenewal), newRows = rows.filter(s => !isRenewal(s));
    const prior = priorRangeOf();
    const priorRows = pool.filter(s => { if (EXCLUDED.has(s.audit_status)) return false; if (!hasAppt(s)) return false; const day = localDay(s.created_at) || s.sold_date; return day && day >= prior.start && day <= prior.end && !isRenewal(s); });
    const priorRevenue = rev(priorRows);
    // Add-on sales count in revenue, sales and the leaderboard, but not in the plan averages / mix tiles (per Isaac, Oct 15).
    const isAddOnSale = (s) => s.sale_kind === 'upsell';
    const subs = rows.filter(s => !isOts(s) && !isAddOnSale(s));
    // Multi-year % (per Isaac): anything sold by the house "RIDD Account"
    // login is out of the ratio (shown in its own column on the drill).
    // "RIDD Account" is an app USER (per Isaac), so the sale carries a rep_id
    // and the CRM name may be blank — resolve the seller's display name the
    // same way the leaderboard does and match on that.
    const _profName = (id) => { if (!id) return ''; const p = (state.allProfiles || []).find(x => x.id === id) || (state.profile && state.profile.id === id ? state.profile : null); return p ? String(p.full_name || p.email || '') : ''; };
    const sellerName = (s) => _profName(s.rep_id) || String(s._crmRep || '');
    // The CRM stores names "Last, First" — "Account, RIDD" — so match on the
    // words, not the order.
    // Excluded like the house account (per Isaac, Oct 14): anything sourced "6 Brothers" sits in the Excluded columns too.
    const isSixBrothers = (s) => /\b6\s*brothers\b|\bsix\s*brothers\b/i.test(String((typeof sourceOf === 'function' ? sourceOf(s) : '') || s.source || s.subscription_source || s._crmSource || ''));
    const isHouse = (s) => { const n = sellerName(s).toLowerCase(); return (/\bridd\b/.test(n) && /\baccount\b/.test(n)) || (typeof FR_SYSTEM_NAME_RE !== 'undefined' && FR_SYSTEM_NAME_RE.test(sellerName(s))) || isSixBrothers(s); };
    // Agent performance, not the automated account (per Isaac): every rate
    // tile runs on rowsAgent / subsMy; the house rows stay in the revenue.
    const rowsAgent = rows.filter(s => !isHouse(s) && !isAddOnSale(s));
    const subsMy = subs.filter(s => !isHouse(s));
    const subsAcv = subsMy.filter(s => !isRenewal(s));   // ACV (per Isaac): renewals out as well
    // MY % leaves renewals out too (per Isaac, Sep 24) — they show in the
    // drill's Excluded column beside the house account.
    const subsMyNR = subsMy.filter(s => !isRenewal(s));
    const my = subsMyNR.map(s => (typeof myBucketOf === 'function') ? myBucketOf(s) : null).filter(Boolean);
    const multi = my.filter(b => b === 'multi').length;
    // Signed Agreement % (per Isaac, Sep 24): EVERY agent sale — one-time,
    // renewals, new — signed or not; RIDD Account (house) sits in Excluded,
    // along with anything the snapshot hasn't picked up yet. Source: the
    // row's own crm_contract_state (auto-logged sales), else the snapshot
    // row for that subscription (by id, then customer # + service).
    const _snapByCustSvc = (() => { const m = new Map(); for (const r of (state.reportingSubscriptions || [])) if (r.customer_id != null) m.set(String(r.customer_id) + '|' + String(r.subscription || '').trim().toLowerCase(), r); return m; })();
    // The app's own sales row for a CRM-feed sale (per Isaac, Oct 13): the live
    // pull stamps crm_contract_state there and re-checks it every run, so a
    // sale from an hour ago is known before the snapshot has it.
    const _twin = (() => { const bySub = new Map(), byCust = new Map(); for (const x of (state.allSales || [])) { if (!x.crm_contract_state) continue; if (x.crm_subscription_id != null) bySub.set(String(x.crm_subscription_id), x); if (x.customer_number != null) { byCust.set(String(x.customer_number) + '|' + String(x.crm_subscription || '').trim().toLowerCase(), x); byCust.set(String(x.customer_number), x); } } return { bySub, byCust }; })();
    const _signedFromData = (s) => {
      if (s.crm_contract_state) return String(s.crm_contract_state) === 'signed';
      const tw = (s.crm_subscription_id != null && _twin.bySub.get(String(s.crm_subscription_id)))
        || (s.customer_number != null && (_twin.byCust.get(String(s.customer_number) + '|' + String(s._crmService || s.service_name || '').trim().toLowerCase()) || _twin.byCust.get(String(s.customer_number))));   // signing is per customer, so the customer # alone is enough
      if (tw) return String(tw.crm_contract_state) === 'signed';
      const snap = (s.crm_subscription_id != null && _snapBySub.get(String(s.crm_subscription_id)))
        || (s.customer_number != null && _snapByCustSvc.get(String(s.customer_number) + '|' + String(s._crmService || s.service_name || '').trim().toLowerCase()));
      // Signed in the last two days per the live pull (app_settings.crm_signed_recent) —
      // covers CRM sales with no app row (one-time jobs, sellers with no account).
      const recent = state._crmSignedRecent;
      if (recent && s.customer_number != null && recent.has(String(s.customer_number))) return true;
      return snap ? String(snap.contract_state || 'none') === 'signed' : null;
    };
    // PAUSED (per Isaac, Oct 14): FieldRoutes is building the endpoint that
    // says reliably who signed, so until it lands every agent sale reads "No"
    // (tile shows 0%) — house account / 6 Brothers still sit in Excluded.
    // All the lookup logic above stays; flip TV_SIGNED_PAUSED to false to use it.
    const signedOf = (s) => TV_SIGNED_PAUSED ? false : _signedFromData(s);
    const sgKnown = rowsAgent.filter(s => signedOf(s) != null);
    const sgYes = sgKnown.filter(s => signedOf(s) === true), sgNo = sgKnown.filter(s => signedOf(s) === false);
    const sgExcl = rows.filter(s => isHouse(s) || signedOf(s) == null);
    const signedPct = sgKnown.length ? sgYes.length / sgKnown.length * 100 : null;
    const apPool = rowsAgent.filter(s => s._crm);
    const ap = apPool.length ? apPool.filter(s => s._crmAutoPay).length / apPool.length : null;   // agent sales only
    // Reps — CRM sellers without an app account rank under their CRM name.
    const agg = new Map();
    rows.forEach(s => {
      const key = s.rep_id || (s._crm && s._crmRep && !(typeof FR_SYSTEM_NAME_RE !== 'undefined' && FR_SYSTEM_NAME_RE.test(s._crmRep)) ? 'crm:' + s._crmRep : null);
      if (!key) return;
      if (!agg.has(key)) agg.set(key, { key, id: s.rep_id, crm: s._crmRep, revenue: 0, count: 0, last: null, sales: [] });
      const a = agg.get(key); a.revenue += Number(s.revenue_amount) || 0; a.count++; a.sales.push(s);
      const t = saleAt(s); if (t && (!a.last || t > a.last)) a.last = t;
    });
    const profOf = (a) => (state.allProfiles || []).find(p => p.id === a.id) || (state.profile && state.profile.id === a.id ? state.profile : null);
    const reps = [...agg.values()].map(a => {
      const p = profOf(a);
      const name = p ? (p.full_name || p.email || 'Rep') : (typeof flipLastFirst === 'function' ? flipLastFirst(a.crm) : a.crm);
      const initials = p && p.initials ? p.initials : String(name).split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
      return { ...a, name, initials, avatar: p ? p.avatar_url : '' };
    }).sort((x, y) => y.revenue - x.revenue);
    // Offices
    const offAgg = new Map();
    rows.forEach(s => { const o = (state.offices || []).find(x => x.id === s.office_id); const n = o ? o.name : (s._crmOffice || 'Unassigned'); if (!offAgg.has(n)) offAgg.set(n, { name: n, revenue: 0, renewal: 0, total: 0 }); const g = offAgg.get(n); const v = Number(s.revenue_amount) || 0; g.total += v; if (isRenewal(s)) g.renewal += v; else g.revenue += v; });
    const offices = [...offAgg.values()].sort((a, b) => b.revenue - a.revenue);   // revenue = NEW (the headline); renewal + total ride along
    const latest = [...rows].sort((a, b) => saleKey(b) - saleKey(a));   // newest sale first — by the CRM's clock, not sync order
    const goal = goalFor(range);
    return { range, rows, revenue: rev(newRows), newCount: newRows.length, totalRevenue: rev(rows), renewalRevenue: rev(renewRows), renewalCount: renewRows.length, count: rows.length, prior, priorRevenue, priorCount: priorRows.length,
      avgInitial: subsMy.length ? subsMy.reduce((a, s) => a + (Number(s.initial_amount) || 0), 0) / subsMy.length : 0,   // house account out
      avgMonthly: subsMy.length ? subsMy.reduce((a, s) => a + (Number(s.monthly_amount) || 0), 0) / subsMy.length : 0,   // house account out
      avgContract: subsAcv.length ? rev(subsAcv) / subsAcv.length : 0,   // recurring NEW subs — house account, one-time and renewals out
      multiPct: my.length ? multi / my.length * 100 : 0, autoPay: ap, signedPct, recMix: (() => { const nr = rowsAgent.filter(s => !isRenewal(s)); return nr.length ? subsMyNR.length / nr.length * 100 : 0; })(),   /* renewals out (per Isaac, Oct 14) */ reps, offices, latest, goal,
      splits: {
        multi: { yes: subsMyNR.filter(s => (typeof myBucketOf === 'function' ? myBucketOf(s) : null) === 'multi'), no: subsMyNR.filter(s => (typeof myBucketOf === 'function' ? myBucketOf(s) : null) === 'twelve'), excluded: subs.filter(s => isHouse(s) || isRenewal(s)) },
        signed: { yes: sgYes, no: sgNo, excluded: sgExcl },
        autopay: { yes: apPool.filter(s => s._crmAutoPay), no: apPool.filter(s => !s._crmAutoPay), excluded: rows.filter(s => s._crm && isHouse(s)) },
        recmix: { yes: subsMyNR, no: rowsAgent.filter(s => isOts(s) && !isRenewal(s)), excluded: rows.filter(s => isHouse(s) || isRenewal(s)) },   // renewals sit in Excluded (per Isaac, Oct 14)
        // Price-point drills (per Isaac): initial ≥ $99 / under, recurring ≥ $59 / under, ACV ≥ $700 / under.
        initial: { yes: subsMy.filter(s => (Number(s.initial_amount) || 0) >= lastResortMin()), no: subsMy.filter(s => (Number(s.initial_amount) || 0) < lastResortMin()), excluded: subs.filter(isHouse) },
        recurring: { yes: subsMy.filter(s => (Number(s.monthly_amount) || 0) >= 59), no: subsMy.filter(s => (Number(s.monthly_amount) || 0) < 59), excluded: subs.filter(isHouse) },
        // ACV (per Isaac): RIDD Account sales and one-time services sit out of the average, in their own column.
        acv: { yes: subsAcv.filter(s => (Number(s.revenue_amount) || 0) >= 700), no: subsAcv.filter(s => (Number(s.revenue_amount) || 0) < 700), excluded: rows.filter(s => isHouse(s) || isOts(s) || isRenewal(s)) },
      } };
  };

  // ── pieces ──
  const eyebrow = (t, extra = {}) => el('div', { style: { fontFamily: MONO, fontSize: '11px', letterSpacing: '.24em', textTransform: 'uppercase', color: T.dim, ...extra } }, t);
  const figure = (v, size, color) => el('div', { style: { fontFamily: MONO, fontSize: size, lineHeight: '1', color: color || T.ink, fontVariantNumeric: 'tabular-nums' } }, v);
  const panel = (children, extra = {}) => { const { onclick, ...st } = extra; return el('div', { style: { background: T.surface, border: '1px solid ' + T.hair, padding: '20px 24px', display: 'flex', flexDirection: 'column', minHeight: '0', ...st }, onclick: onclick || null }, ...children); };
  // Red / yellow / green bands (per Isaac, Oct 13). redBelow: under it is red;
  // greenAt: at/over it is green (greenOver = strictly over); in between yellow.
  const BAND = { red: '#F87171', yellow: '#FACC15', green: '#4ADE80' };
  const band = (v, redBelow, greenAt, strict) => { const n = Number(v); if (v == null || !isFinite(n)) return null; return n < redBelow ? BAND.red : (strict ? n > greenAt : n >= greenAt) ? BAND.green : BAND.yellow; };
  // Split a drill's sales at the tile's band lines — green, yellow, red columns.
  const bandCols = (rows, of, redBelow, greenAt, strict, f) => {
    const g = [], y = [], r = [];
    for (const x of rows) { const n = of(x); if (n < redBelow) r.push(x); else if (strict ? n > greenAt : n >= greenAt) g.push(x); else y.push(x); }
    const byAmt = (a, b) => of(b) - of(a);
    return [
      { label: (strict ? 'Over ' : '') + f(greenAt) + (strict ? '' : ' and up'), rows: g.sort(byAmt), color: BAND.green },
      { label: f(redBelow) + ' \u2013 ' + f(greenAt), rows: y.sort(byAmt), color: BAND.yellow },
      { label: 'Under ' + f(redBelow), rows: r.sort(byAmt), color: BAND.red },
    ];
  };
  const tile = (label, value, sub, drill, color) => el('div', { style: { background: T.surface, border: '1px solid ' + T.hair, borderLeft: color ? '3px solid ' + color : '1px solid ' + T.hair, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '0', cursor: drill ? 'pointer' : 'default' }, title: drill ? 'Tap to see what is behind this number' : '', onclick: drill || null },
    eyebrow(label), figure(value, 'clamp(22px, 2.2vw, 34px)', color));   // (descriptions dropped per Isaac — the room knows what these are)
  // Drill panel (per Isaac): what is pulling a % up or down — the sales
  // that count on one side, the ones that don't on the other, as they were sold.
  // `metric` (optional): { of: (sale) → number, fmt: (n) → string } — what the
  // right-hand figure and the column summary show instead of ACV (per Isaac:
  // initial $ on the Avg initial drill, recurring $ on Avg recurring, term on Multi-year).
  const openDrill = (title, yesLabel, yes, noLabel, no, repName, hero, metric) => {
    const amtOf = metric ? metric.of : (x) => Number(x.revenue_amount) || 0;
    const amtFmt = metric ? metric.fmt : money;
    const summary = (xs) => { if (!xs.length) return ''; const tot = xs.reduce((a, x) => a + amtOf(x), 0); return metric ? (metric.avg === false ? '' : '  ·  avg ' + amtFmt(tot / xs.length)) : '  ·  ' + money(tot); };
    // The drill is its own layer on <body> (the 30-second repaint rebuilds
    // the overlay's children, which used to wipe an open drill out from
    // under the viewer — per Isaac). Closing it repaints so nothing is stale.
    const back = el('div', { 'data-tv-drill': '1', style: { position: 'fixed', inset: '0', background: 'rgba(10,11,13,.82)', zIndex: '10000', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px' } });
    const close = () => { back.remove(); document.removeEventListener('keydown', esc, true); try { render(); } catch (e) { /* keep the board up */ } };
    back.addEventListener('click', (e) => { if (e.target === back) close(); });
    const esc = (e) => { if (e.key === 'Escape') { close(); e.stopPropagation(); } };
    document.addEventListener('keydown', esc, true);
    const list = (label, xs, hot, color) => el('div', { style: { minWidth: '0', display: 'flex', flexDirection: 'column' } },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px', borderTop: color ? '3px solid ' + color : 'none', paddingTop: color ? '8px' : '0' } }, eyebrow(label, { color: color || (hot ? T.ember : T.ink) }), eyebrow(xs.length + ' sale' + (xs.length === 1 ? '' : 's') + summary(xs))),
      el('div', { style: { overflow: 'auto', maxHeight: '60vh' } },
        ...(xs.length ? xs.map((x, i) => el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '12px', alignItems: 'baseline', padding: '9px 0', borderTop: i ? '1px solid ' + T.hair : 'none' } },
          el('div', { style: { minWidth: '0' } },
            el('div', { style: { fontFamily: HEAD, fontSize: '18px', letterSpacing: '.02em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, repName(x),
              x.customer_number ? el('span', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.06em', textTransform: 'none', marginLeft: '10px' }, title: 'Customer ID' }, '#' + x.customer_number) : null),
            el('div', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.04em', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
              el('span', { style: { color: T.ink } }, (Number(x.contract_months) > 1 ? Number(x.contract_months) + ' MO' : 'ONE-TIME')), '  ·  ' + (x._crmService || x.service_name || '—') + (sourceOf(x) ? '  ·  ' + sourceOf(x) : '') + (saleAt(x) ? '  ·  ' + ago(saleAt(x)) : ''))),
          figure(amtFmt(amtOf(x)), '16px', color)))
        : [el('div', { style: { fontFamily: MONO, color: T.dim, fontSize: '13px' } }, 'None.')])));
    back.append(el('div', { style: { background: T.surface, border: '1px solid ' + T.hair, color: T.ink, width: 'min(1200px, 94vw)', padding: '26px 30px', display: 'flex', flexDirection: 'column', gap: '18px' } },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        hero ? el('div', {}) : el('div', { style: { fontFamily: HEAD, fontSize: '32px', letterSpacing: '.02em', textTransform: 'uppercase' } }, title),
        el('button', { style: { width: '36px', height: '36px', background: 'transparent', border: '1px solid ' + T.hair, color: T.dim, cursor: 'pointer', fontSize: '18px' }, onclick: close }, '\u00d7')),
      hero || null,
      // Columns follow the tile's red / yellow / green bands (per Isaac, Oct 14):
      // dollar tiles split three ways at the band lines; yes / no tiles color green / red.
      (metric && metric.bands) ? el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(' + (metric.bands.length + (metric.third ? 1 : 0)) + ', minmax(0, 1fr))', gap: '24px' } }, ...metric.bands.map(b => list(b.label, b.rows, false, b.color)), metric.third ? list(metric.third.label, metric.third.rows, false) : null) :
      no ? el('div', { style: { display: 'grid', gridTemplateColumns: metric && metric.third ? '1fr 1fr 1fr' : '1fr 1fr', gap: '28px' } }, list(yesLabel, yes, true, metric && metric.yesColor), list(noLabel, no, false, metric && metric.noColor), metric && metric.third ? list(metric.third.label, metric.third.rows, false) : null)
         : list(yesLabel, [...yes].sort((a, b) => saleKey(b) - saleKey(a)), true)));
    // In fullscreen the browser only paints the fullscreen element's
    // subtree — a layer on <body> opens invisibly (Pere's TV, per Isaac,
    // Sep 21) and the board then freezes waiting for it to close. Mount the
    // drill inside whatever is fullscreen; render() already stands still
    // while a drill is open, so the 30-second repaint can't wipe it.
    (document.fullscreenElement || document.body).append(back);
  };
  const avatar = (r, px) => r.avatar
    ? el('img', { src: r.avatar, alt: '', style: { width: px + 'px', height: px + 'px', objectFit: 'cover', flexShrink: '0' } })   // (colour, per Isaac — the grayscale treatment is gone)
    : el('div', { style: { width: px + 'px', height: px + 'px', flexShrink: '0', background: T.surface2, color: T.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontSize: Math.round(px * .42) + 'px', letterSpacing: '.04em' } }, r.initials);
  const ago = (v) => { const d = new Date(v); if (isNaN(d)) return ''; const m = Math.max(0, Math.round((Date.now() - d) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hr ago' : Math.round(m / 1440) + ' d ago'; };

  const render = () => {
    // A timed repaint waits while the range dropdown is open, so it can't snap shut mid-pick.
    { const ae = document.activeElement; if (ae && ae.tagName === 'SELECT' && overlay.contains(ae)) return; }
    if (document.querySelector('[data-tv-drill]')) return;   // someone is reading a drill — repaint when it closes
    const d = compute();
    const keys = new Set(d.rows.map(s => s.id));
    const fresh = lastKeys ? [...keys].some(k => !lastKeys.has(k)) : false;
    lastKeys = keys;
    const inFs = !!document.fullscreenElement;
    const leader = d.reps[0];
    const repNameOf = (s) => { const r = d.reps.find(x => x.key === (s.rep_id || ('crm:' + s._crmRep))); return r ? r.name : (s._crmRep || 'Rep'); };
    const maxRev = leader ? leader.revenue : 0;
    const goalPct = d.goal > 0 ? Math.min(1, d.revenue / d.goal) : null;

    // Header: wordmark · INSIDE SALES · range pills · clock · fullscreen · close
    const clock = el('div', { style: { fontFamily: MONO, fontSize: '13px', letterSpacing: '.12em', color: T.dim } });
    const tick = () => { clock.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: BOARD_TZ }).toUpperCase() + ' MT' + '  ·  ' + new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(); };
    tick();
    const pill = (id, label) => el('button', { style: { fontFamily: MONO, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', padding: '8px 12px', background: state._tvRange === id ? T.ink : 'transparent', color: state._tvRange === id ? T.void : T.dim, border: '1px solid ' + (state._tvRange === id ? T.ink : T.hair), cursor: 'pointer' }, onclick: () => { state._tvRange = id; render(); } }, label);
    const iconBtn = (title, path, fn) => { const b = el('button', { title, style: { width: '36px', height: '36px', background: 'transparent', border: '1px solid ' + T.hair, color: T.dim, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }, onclick: fn }); b.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">' + path + '</svg>'; return b; };
    const header = el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '24px', padding: '22px 36px 0' } },
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '22px' } },
        (typeof riddmadeWordmark === 'function') ? riddmadeWordmark(190) : el('div', { style: { fontFamily: HEAD, fontSize: '28px' } }, 'RIDDMADE'),
        el('div', { style: { width: '1px', height: '22px', background: T.hair } }),
        eyebrow('Inside Sales League', { color: T.ink }),
        el('div', { style: { width: '1px', height: '22px', background: T.hair } }),
        // Last data sync (the CRM feed the board reads) + the board's own last repaint.
        // One stamp (per Isaac): the board's last refresh, in Mountain time.
        eyebrow(new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: BOARD_TZ }).replace(',', ' ·') + '  ·  ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: BOARD_TZ }) + ' MT')),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '18px' } },
        // Date range dropdown (per Isaac, Oct 14) — the main dashboard's ranges.
        el('select', { class: 'tv-range', title: 'Date range (keys 1–4: Today · This week · This month · This year)',
          style: { fontFamily: MONO, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', height: '36px', boxSizing: 'border-box', lineHeight: '34px', padding: '0 30px 0 12px', background: T.void, color: T.ink, border: '1px solid ' + T.hair, borderRadius: '0', cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none',
            backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=%27http://www.w3.org/2000/svg%27 width=%2710%27 height=%276%27%3E%3Cpath d=%27M0 0l5 6 5-6z%27 fill=%27%23F4F6F8%27/%3E%3C/svg%3E")', backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center' },
          onchange: (e) => { state._tvRange = e.target.value; e.target.blur(); render(); } },
          ...RANGES.map(([id, l]) => el('option', { value: id, selected: state._tvRange === id }, l))),
        // (header clock retired per Isaac — the stamp on the left carries date + time)
        // (Resync button retired per Isaac, Sep 18 — the snapshot lands every 30 min, the live feed every 15, the board pulls every 5.)
        iconBtn(inFs ? 'Exit fullscreen (F)' : 'Fullscreen (F)', inFs ? '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>' : '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>', toggleFs),
        iconBtn('Close (Esc)', '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', cleanup)));

    // Hero: THE number (ember, Anton, once) + goal bar + the stat tiles.
    const hero = el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: '18px', padding: '18px 36px 0', alignItems: 'stretch', flex: '0 0 auto' } },
      state._tvHeroOffices ? panel([el('div', { style: { position: 'absolute', inset: '20px 24px', display: 'flex', flexDirection: 'column', minHeight: '0' } },
        // Tap-swapped view (per Isaac): the window's NEW revenue by branch,
        // in the SAME footprint as the number (the list scrolls inside).
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, eyebrow(d.range.label + ' · new revenue by branch · bar = new'), eyebrow(money(d.revenue) + ' new · ' + money(d.totalRevenue) + ' total')),
        el('div', { class: 'tv-scroll', style: { display: 'flex', flexDirection: 'column', gap: '8px', marginTop: '12px', overflowY: 'auto', minHeight: '0', flex: '1', paddingRight: '4px' } },
          ...(d.offices.length ? d.offices.map((o, i) => el('div', {},
            el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '4px', gap: '12px' } },
              el('div', { style: { fontFamily: HEAD, fontSize: 'clamp(16px, 1.3vw, 22px)', letterSpacing: '.03em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, o.name),
              el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '18px', whiteSpace: 'nowrap' } },
                el('span', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.06em' } }, 'RENEWAL ' + money(o.renewal)),
                el('span', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.06em' } }, 'TOTAL ' + money(o.total)),
                figure(money(o.revenue), 'clamp(15px, 1.3vw, 22px)', i === 0 ? T.ember : T.ink))),
            el('div', { style: { height: '4px', background: T.surface2 } }, el('div', { style: { height: '100%', width: (d.offices[0].revenue ? o.revenue / d.offices[0].revenue * 100 : 0) + '%', background: i === 0 ? T.ember : T.dim } }))))
          : [el('div', { style: { fontFamily: MONO, color: T.dim, fontSize: '13px' } }, 'No sales in this window yet.')])))], { cursor: 'pointer', position: 'relative', padding: '0', onclick: () => { state._tvHeroOffices = false; render(); } })
      : panel([
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, eyebrow(d.range.label + ' · new revenue'), eyebrow(d.newCount + ' sale' + (d.newCount === 1 ? '' : 's') + (d.renewalCount ? '  |  ' + d.renewalCount + ' renewal' + (d.renewalCount === 1 ? '' : 's') : ''))),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '22px', flexWrap: 'wrap', marginTop: '6px' } },   // Yesterday sits level with the big number (per Isaac, Oct 14)
          el('div', { class: fresh ? 'tv-pulse' : '', style: { fontFamily: HEAD, fontSize: 'clamp(64px, 6.8vw, 124px)', lineHeight: '.95', letterSpacing: '.01em', color: T.ember, fontVariantNumeric: 'tabular-nums' } }, money(d.revenue)),
          // Prior period at a quarter of the size (per Isaac): yesterday / last week / last month / last year, to date.
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            eyebrow(d.prior.label),
            el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
              figure(money(d.priorRevenue), 'clamp(16px, 1.7vw, 31px)', T.dim),
              d.priorRevenue > 0 ? el('span', { style: { fontFamily: MONO, fontSize: '11px', letterSpacing: '.06em', color: d.revenue >= d.priorRevenue ? T.ember : T.dim } }, (d.revenue >= d.priorRevenue ? '+' : '−') + Math.round(Math.abs(d.revenue - d.priorRevenue) / d.priorRevenue * 100) + '%') : null))),
        // Total and renewal, minimally (per Isaac) — the headline stays NEW.
        el('div', { style: { display: 'flex', gap: '28px', marginTop: '10px', flexWrap: 'wrap' } },
          el('div', {}, eyebrow('Total'), figure(money(d.totalRevenue), 'clamp(16px, 1.4vw, 22px)', T.ink)),
          el('div', {}, eyebrow('Renewal'), figure(money(d.renewalRevenue), 'clamp(16px, 1.4vw, 22px)', T.dim))),
        el('div', { style: { marginTop: 'auto', paddingTop: '12px' } },
          el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' } },
            eyebrow(d.goal > 0 ? d.range.label + ' goal ' + money(d.goal) : 'No goal set'),
            d.goal > 0 ? el('div', { style: { fontFamily: MONO, fontSize: '13px', color: goalPct >= 1 ? T.ember : T.ink, letterSpacing: '.06em' } }, Math.round(goalPct * 100) + '%' + (d.revenue >= d.goal ? '  ·  GOAL HIT' : '  ·  ' + money(d.goal - d.revenue) + ' to go')) : null),
          el('div', { style: { height: '6px', background: T.surface2, position: 'relative' } },
            el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: ((goalPct || 0) * 100) + '%', background: T.ember, transition: 'width .6s ease' } })))], { cursor: 'pointer', onclick: () => { state._tvHeroOffices = true; render(); } }),
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: '1fr', gap: '10px', minWidth: '0' } },
        // Layout (per Isaac, Sep 24): [Avg initial | Avg recurring] · Avg ACV /
        // Multi-year · Rec mix / Signed agreement · Auto pay.
        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', minWidth: '0', minHeight: '0', height: '100%', alignItems: 'stretch' } },   // two square cards, full row height
          tile('Avg initial', money(d.avgInitial), 'subscriptions', () => openDrill('Avg initial · ' + money(d.avgInitial), 'Initial $' + lastResortMin() + ' and up', d.splits.initial.yes, 'Initial under $' + lastResortMin() + '', d.splits.initial.no, repNameOf, null, { of: (x) => Number(x.initial_amount) || 0, fmt: money, third: { label: 'Excluded · RIDD Account, 6 Brothers', rows: d.splits.initial.excluded }, bands: bandCols([...d.splits.initial.yes, ...d.splits.initial.no], (x) => Number(x.initial_amount) || 0, 80, 100, false, money) }), band(d.avgInitial, 80, 100)),
          tile('Avg recurring', money(d.avgMonthly), 'per month', () => openDrill('Avg recurring · ' + money(d.avgMonthly), 'Recurring $59 and up', d.splits.recurring.yes, 'Recurring under $59', d.splits.recurring.no, repNameOf, null, { of: (x) => Number(x.monthly_amount) || 0, fmt: (n) => money(n) + '/mo', third: { label: 'Excluded · RIDD Account, 6 Brothers', rows: d.splits.recurring.excluded }, bands: bandCols([...d.splits.recurring.yes, ...d.splits.recurring.no], (x) => Number(x.monthly_amount) || 0, 60, 70, false, (n) => money(n) + '/mo') }), band(d.avgMonthly, 60, 70))),
        tile('Avg ACV', money(d.avgContract), 'contract value per sale', () => openDrill('Avg ACV · ' + money(d.avgContract), 'ACV $700 and up', d.splits.acv.yes, 'ACV under $700', d.splits.acv.no, repNameOf, null, { of: (x) => Number(x.revenue_amount) || 0, fmt: money, third: { label: 'Excluded · RIDD Account, 6 Brothers, one-time, renewals', rows: d.splits.acv.excluded }, bands: bandCols([...d.splits.acv.yes, ...d.splits.acv.no], (x) => Number(x.revenue_amount) || 0, 700, 800, true, money) }), band(d.avgContract, 700, 800, true)),
        tile('Multi-year', pct(d.multiPct), '18 mo and up', () => openDrill('Multi-year · ' + pct(d.multiPct), 'Multi-year (18 mo+)', d.splits.multi.yes, '12-month', d.splits.multi.no, repNameOf, null, { of: (x) => Number(x.contract_months) || 0, fmt: (n) => n > 1 ? Math.round(n) + ' MO' : 'ONE-TIME', avg: false, third: { label: 'Excluded · RIDD Account, 6 Brothers, renewals', rows: d.splits.multi.excluded }, yesColor: BAND.green, noColor: BAND.red }), band(d.multiPct, 50, 60, true)),
        tile('Rec mix', pct(d.recMix), 'recurring subs of all sales', () => openDrill('Rec mix · ' + pct(d.recMix), 'Recurring subscriptions', d.splits.recmix.yes, 'One-time services', d.splits.recmix.no, repNameOf, null, { of: (x) => Number(x.revenue_amount) || 0, fmt: money, avg: false, third: { label: 'Excluded · RIDD Account, 6 Brothers', rows: d.splits.recmix.excluded }, yesColor: BAND.green, noColor: BAND.red }), band(d.recMix, 80, 90, true)),
        tile('Signed agreement', d.signedPct == null ? '—' : pct(d.signedPct), 'every agent sale', () => openDrill('Signed agreement · ' + (d.signedPct == null ? '—' : pct(d.signedPct)), 'Signed', d.splits.signed.yes, 'Not signed', d.splits.signed.no, repNameOf, null, { of: (x) => Number(x.revenue_amount) || 0, fmt: money, avg: false, third: { label: 'Excluded · RIDD Account, 6 Brothers, not in FieldRoutes yet', rows: d.splits.signed.excluded }, yesColor: BAND.green, noColor: BAND.red }), band(d.signedPct, 100, 100)),   // per Isaac: under 100% red, 100% green
        tile('Auto pay', d.autoPay == null ? '—' : pct(d.autoPay * 100), 'of CRM sales', () => openDrill('Auto pay · ' + (d.autoPay == null ? '—' : pct(d.autoPay * 100)), 'On auto pay', d.splits.autopay.yes, 'Not on auto pay', d.splits.autopay.no, repNameOf, null, { of: (x) => Number(x.revenue_amount) || 0, fmt: money, avg: false, third: { label: 'Excluded · RIDD Account, 6 Brothers', rows: d.splits.autopay.excluded }, yesColor: BAND.green, noColor: BAND.red }), band(d.autoPay == null ? null : d.autoPay * 100, 100, 100))));   // per Isaac: under 100% red, 100% green

    // Rep drill hero (per Isaac): the picture blown up, the day's numbers big.
    const repHero = (r, rank) => {
      const sales = r.sales || [];
      const subsR = sales.filter(s => !isOts(s));
      const myR = subsR.map(s => (typeof myBucketOf === 'function') ? myBucketOf(s) : null).filter(Boolean);
      const multiR = myR.filter(b => b === 'multi').length;
      const crmR = sales.filter(s => s._crm), apR = crmR.length ? crmR.filter(s => s._crmAutoPay).length / crmR.length : null;
      const avgR = sales.length ? r.revenue / sales.length : 0;
      const stat = (label, val, color) => el('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px', minWidth: '0' } },
        eyebrow(label), figure(val, 'clamp(30px, 3vw, 48px)', color || T.ink));
      return el('div', { style: { display: 'grid', gridTemplateColumns: 'auto minmax(0, 1fr)', gap: '32px', alignItems: 'center', paddingBottom: '18px', borderBottom: '1px solid ' + T.hair } },
        avatar(r, 180),
        el('div', { style: { minWidth: '0', display: 'flex', flexDirection: 'column', gap: '18px' } },
          el('div', {},
            eyebrow('#' + String(rank + 1).padStart(2, '0') + ' · ' + d.range.label, { color: rank === 0 ? T.ember : T.dim }),
            el('div', { style: { fontFamily: HEAD, fontSize: 'clamp(40px, 4.5vw, 72px)', lineHeight: '1', letterSpacing: '.02em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: '8px' } }, r.name)),
          el('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(5, minmax(0, 1fr))', gap: '22px' } },
            stat('Revenue', money(r.revenue), T.ember),
            stat('Sales', String(r.count)),
            stat('Avg sale', money(avgR)),
            stat('Multi-year', myR.length ? pct(multiR / myR.length * 100) : '—'),
            stat('Auto pay', apR == null ? '—' : pct(apR * 100)))));
    };
    // Body: leaderboard | offices + latest
    const board = panel([
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' } }, eyebrow('Leaderboard'), eyebrow('revenue · sales')),
      d.reps.length ? el('div', { class: 'tv-scroll', style: { display: 'flex', flexDirection: 'column', gap: '6px', overflowY: 'auto', flex: '1', minHeight: '0', paddingRight: '4px' } },
        ...d.reps.map((r, i) => el('div', { title: 'Tap for ' + r.name + '’s sales', onclick: () => openDrill(r.name + ' · ' + d.range.label, 'Sales · ' + d.range.label, r.sales, null, null, (x) => (x.customer_name || (x.customer_number ? 'Customer #' + x.customer_number : '—')), repHero(r, i)), style: { cursor: 'pointer', display: 'grid', gridTemplateColumns: '44px 56px minmax(0, 1fr) auto', alignItems: 'center', gap: '16px', padding: '8px 10px', background: i === 0 ? T.surface2 : 'transparent', borderLeft: i === 0 ? '3px solid ' + T.ember : '3px solid transparent' } },
          el('div', { style: { fontFamily: MONO, fontSize: '14px', color: i === 0 ? T.ember : T.dim, letterSpacing: '.08em' } }, String(i + 1).padStart(2, '0')),
          avatar(r, 56),
          el('div', { style: { minWidth: '0' } },
            el('div', { style: { fontFamily: HEAD, fontSize: 'clamp(22px, 2vw, 32px)', lineHeight: '1', letterSpacing: '.02em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, r.name),
            el('div', { style: { height: '4px', marginTop: '8px', background: T.surface2, width: '100%' } }, el('div', { style: { height: '100%', width: (maxRev ? r.revenue / maxRev * 100 : 0) + '%', background: i === 0 ? T.ember : T.dim, transition: 'width .6s ease' } }))),
          el('div', { style: { textAlign: 'right' } },
            figure(money(r.revenue), 'clamp(20px, 1.9vw, 30px)', i === 0 ? T.ink : T.ink),
            el('div', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, marginTop: '4px', letterSpacing: '.06em' } }, r.count + ' sale' + (r.count === 1 ? '' : 's') + (r.last ? ' · ' + ago(r.last) : ''))))))
      : el('div', { style: { fontFamily: MONO, color: T.dim, fontSize: '13px', padding: '24px 0' } }, 'No sales in this window yet.')]);
    const offMax = d.offices.length ? d.offices[0].revenue : 0;
    const officesEl = panel([
      eyebrow('By branch'),
      el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' } },
        ...(d.offices.length ? d.offices.slice(0, 7).map((o, i) => el('div', {},
          el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' } },
            el('div', { style: { fontFamily: VOICE, fontWeight: 600, fontSize: '14px', textTransform: 'uppercase', letterSpacing: '.04em' } }, o.name),
            figure(money(o.revenue), '15px')),
          el('div', { style: { height: '4px', background: T.surface2 } }, el('div', { style: { height: '100%', width: (offMax ? o.revenue / offMax * 100 : 0) + '%', background: i === 0 ? T.ember : T.dim } }))))
        : [el('div', { style: { fontFamily: MONO, color: T.dim, fontSize: '13px' } }, '—')]))]);
    // Add-ons on each sale (per Isaac, Oct 14): FieldRoutes add-on items
    // (add_ons table — service fees / tax / discounts never count) on the
    // sale's own plan, or on the same customer within a day of the sale.
    // Shown as "ADDONS +N"; red when any of them is credited to nobody, so
    // someone can go assign it.
    const _feeLike = /\bfee\b|\btax\b|discount|surcharge/i;
    const _aoBySub = new Map(), _aoByCust = new Map();
    for (const a of (Array.isArray(state._tvAddOns) ? state._tvAddOns : Array.isArray(state.addOns) ? state.addOns : [])) {
      if (!a || a.removed_at || _feeLike.test(String(a.service_name || ''))) continue;
      if (a.subscription_id) (_aoBySub.get(String(a.subscription_id)) || _aoBySub.set(String(a.subscription_id), []).get(String(a.subscription_id))).push(a);
      if (a.customer_id) (_aoByCust.get(String(a.customer_id)) || _aoByCust.set(String(a.customer_id), []).get(String(a.customer_id))).push(a);
    }
    const addOnsFor = (sale) => {
      const out = new Set(_aoBySub.get(String(sale.crm_subscription_id || '')) || []);
      const day = String(sale.sold_date || '').slice(0, 10);
      if (day && sale.customer_number) {
        const d0 = new Date(day + 'T00:00').getTime();
        for (const a of (_aoByCust.get(String(sale.customer_number)) || [])) { const t = new Date(String(a.added_at || '').slice(0, 10) + 'T00:00').getTime(); if (Math.abs(t - d0) <= 86400000) out.add(a); }
      }
      return [...out];
    };
    const latestEl = panel([
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, eyebrow('Latest sales'), eyebrow(d.latest.length + ' today' .replace('today', d.range.label.toLowerCase()))),
      el('div', { class: 'tv-scroll', style: { display: 'flex', flexDirection: 'column', marginTop: '10px', overflowY: 'auto', flex: '1', minHeight: '0', paddingRight: '4px' } },
        ...(d.latest.length ? d.latest.map((s, i) => {
          const r = d.reps.find(x => x.key === (s.rep_id || ('crm:' + s._crmRep)));
          const when = (d) => !d || isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: BOARD_TZ }) + ' MT · ' + ago(d);
          const at = saleAt(s), src = sourceOf(s);
          // One line per sale (per Isaac): NAME | subscription | 12 MO | source … amount, time under the name.
          // Compact rows so more of the day fits without scrolling.
          const sep = () => el('span', { style: { color: T.hair, padding: '0 10px', fontFamily: MONO } }, '|');
          return el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '14px', alignItems: 'center', padding: '7px 0', borderTop: i ? '1px solid ' + T.hair : 'none' } },
            // Two-row grid (per Isaac, Oct 14) so the second line lines up under the first:
            // time under the name, the account's add-ons right under the service type.
            (() => {
              // Red = credited to NOBODY in FieldRoutes (Commission To blank / N/A). A rep whose
              // FieldRoutes login isn't linked to an app account still counts as assigned (per Isaac,
              // Oct 14 — Dylan Kozian's Snake on #107904). Older tv_add_ons() without the employee
              // column falls back to the app profile.
              const _credited = (a) => { const e = String(a.credited_employee_id == null ? '' : a.credited_employee_id).trim(); return ('credited_employee_id' in a) ? (!!e && e !== '0' && e !== '-1') : !!a.credited_profile_id; };
              const ao = addOnsFor(s), unassigned = ao.filter(a => !_credited(a));
              const cell = (col, row, child, extra) => el('div', { style: { gridColumn: col, gridRow: String(row), minWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', ...(extra || {}) } }, child);
              const small = { fontFamily: MONO, fontSize: '10px', color: T.dim, letterSpacing: '.06em', marginTop: '2px' };
              const term = s.sale_kind === 'upsell' ? 'ADD ON' : Number(s.contract_months) > 1 ? Number(s.contract_months) + ' MO' : 'ONE-TIME';   // add-on-only sale reads ADD ON
              const aoSpan = !ao.length
                ? el('span', { style: { letterSpacing: '.08em' } }, 'ADDONS +0')   // no add-ons: ADDONS +0 in the dim gray (per Isaac, Oct 14)
                : el('span', { style: { fontWeight: '700', color: unassigned.length ? BAND.red : BAND.green, letterSpacing: '.08em' },
                    title: ao.map(a => (a.service_name || 'Add-on') + (_credited(a) ? '' : ' — not assigned to a rep')).join('\n') },
                    'ADDONS +' + ao.length + '  ·  ' + ao.map(a => String(a.service_name || 'Add-on').toUpperCase()).join(', '));   // red alone says it's unassigned (per Isaac, Oct 14)
              // NAME | #id | service | term | source; second line: the time under the name, the add-ons under the service (per Isaac, Oct 14).
              const big = { fontFamily: VOICE, fontWeight: 600, fontSize: 'clamp(12px, .95vw, 15px)', color: T.ink };
              return el('div', { style: { display: 'grid', gridTemplateColumns: 'auto auto auto auto max-content auto max-content auto minmax(0, 1fr)', alignItems: 'baseline', minWidth: '0', overflow: 'hidden' } },
                cell('1', 1, el('span', { style: { fontFamily: HEAD, fontSize: 'clamp(17px, 1.35vw, 22px)', letterSpacing: '.02em', textTransform: 'uppercase' } }, (r ? r.name : (s._crmRep || 'Rep'))), { minWidth: 'max-content' }),
                cell('2', 1, s.customer_number ? sep() : null),
                cell('3', 1, s.customer_number ? el('span', { style: { fontFamily: MONO, fontSize: 'clamp(11px, .85vw, 13px)', color: T.dim, letterSpacing: '.06em' }, title: 'Customer ID' }, '#' + s.customer_number) : null, { minWidth: 'max-content' }),
                cell('4', 1, sep()),
                // "Pest 6 + Mole + Rodent" — the plan and what was added on (per Isaac, Oct 15); add-on-only sales show the plan muted.
                cell('5', 1, el('span', { style: { fontFamily: VOICE, color: T.ink } }, (typeof saleServiceWithAddOns === 'function')
                  ? saleServiceWithAddOns(s, s._crmService || s.service_name || s.crm_subscription || '\u2014', ao, { size: 'clamp(12px, .95vw, 15px)', weight: '600', ok: BAND.green, bad: BAND.red, muted: T.dim })
                  : (s._crmService || s.service_name || '\u2014'))),   // the service never truncates
                cell('6', 1, sep()),
                cell('7', 1, el('span', { style: big }, term), { minWidth: 'max-content' }),
                cell('8', 1, src ? sep() : null),
                cell('9', 1, src ? el('span', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.04em' } }, src) : null),
                cell('1 / 4', 2, at ? when(at) : '—', small),
                null);   // (add-ons moved inline with the service, per Isaac, Oct 15)
            })(),
            figure(money(s.revenue_amount), 'clamp(17px, 1.5vw, 24px)', T.ink));
        }) : [el('div', { style: { fontFamily: MONO, color: T.dim, fontSize: '13px' } }, 'Nothing yet.')]))], { flex: '1' });
    const body = el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', gap: '18px', padding: '20px 36px 24px', flex: '1', minHeight: '0' } },
      board,
      latestEl);   // (By branch retired per Isaac — the column is the latest sales.)

    overlay.replaceChildren(el('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } }, header, hero, body));
    timers.forEach(clearInterval); timers = [];
    timers.push(setInterval(tick, 15000));
    timers.push(setInterval(() => { try { render(); } catch (e) { /* keep the board up */ } }, 30000));
  };
  if (!document.getElementById('tv-board-css')) {
    const st = document.createElement('style'); st.id = 'tv-board-css';
    st.textContent = '@keyframes tvPulse{0%{opacity:.35;transform:translateY(6px)}100%{opacity:1;transform:none}} .tv-pulse{animation:tvPulse .7s cubic-bezier(.16,1,.3,1) both} @media (prefers-reduced-motion: reduce){.tv-pulse{animation:none}} .tv-scroll{scrollbar-width:thin;scrollbar-color:#2B2F38 transparent} .tv-scroll::-webkit-scrollbar{width:6px} .tv-scroll::-webkit-scrollbar-thumb{background:#2B2F38} .tv-scroll::-webkit-scrollbar-track{background:transparent}';
    document.head.append(st);
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFs);
  document.body.append(overlay);
  render();
  // The sale clock comes from the CRM snapshot; on a TV that never opened
  // Reporting it isn't in memory yet — pull it once so times are real, not
  // the sync stamp.
  if (state.reportingActiveUploadId && state.reportingSubscriptionsLoadedFor !== state.reportingActiveUploadId && typeof loadReportingSubscriptions === 'function') {
    loadReportingSubscriptions(state.reportingActiveUploadId).then(rows => { if (rows && state.reportingActiveUploadId) { state.reportingSubscriptions = rows; state.reportingSubscriptionsLoadedFor = state.reportingActiveUploadId; _snapBySub.clear(); for (const r of rows) if (r.subscription_id != null && r.sold_at) _snapBySub.set(String(r.subscription_id), r); render(); } }).catch(() => {});
  }
  // Add-ons for the Latest sales flags (per Isaac, Oct 14): the tv_add_ons
  // function (migrations/20261014_tv_add_ons.sql) returns every open add-on —
  // names, dates and who it is credited to, no money — to any signed-in user,
  // so a TV on an office lead's login still sees unassigned ones. Until the
  // migration runs it falls back to state.addOns (own rows, or all for admins).
  const pullSignedRecent = async () => {
    try { const { data } = await supabase.from('app_settings').select('value').eq('key', 'crm_signed_recent').maybeSingle();
      const ids = data && data.value && Array.isArray(data.value.customer_ids) ? data.value.customer_ids : null;
      if (ids) state._crmSignedRecent = new Set(ids.map(String)); } catch (e) { /* snapshot only */ }
  };
  pullSignedRecent().then(() => { try { render(); } catch (e) { /* keep the board up */ } });
  const pullLiveRecent = async () => {
    try { const { data } = await supabase.from('app_settings').select('value').eq('key', 'crm_live_recent').maybeSingle();
      const v = data && data.value;
      if (v && Array.isArray(v.rows) && (!state._crmLiveRecent || state._crmLiveRecent.at !== v.at)) state._crmLiveRecent = v; } catch (e) { /* dataset only */ }
  };
  pullLiveRecent().then(() => { try { render(); } catch (e) { /* keep the board up */ } });
  const pullAddOns = async () => {
    try {
      const since = new Date(); since.setDate(since.getDate() - 400);
      const { data, error } = await supabase.rpc('tv_add_ons', { since: since.toISOString().slice(0, 10) });
      if (!error && Array.isArray(data)) state._tvAddOns = data;
    } catch (e) { /* fall back to state.addOns */ }
  };
  pullAddOns().then(() => { try { render(); } catch (e) { /* keep the board up */ } });
  // Refresh the CRM pool in the background so the board keeps up with the sync.
  const pullFresh = async () => {
    await pullAddOns(); await pullSignedRecent(); await pullLiveRecent();
    try { if (typeof refreshIndicatorsFromCloud === 'function') await refreshIndicatorsFromCloud(true); } catch (e) { /* poll retries */ }
    try { if (typeof refreshSalesData === 'function') await refreshSalesData(); } catch (e) { /* poll retries */ }
    try { render(); } catch (e) { /* keep the board up */ }
  };
  // Fallback poll every 2 minutes (was 5); the realtime channel below is what
  // makes it feel live — this just covers a dropped socket.
  timers.push(setInterval(pullFresh, 2 * 60000));
  // Realtime: any insert / update on `sales` (the FieldRoutes live pull writes
  // here every few minutes) re-pulls the sales pool and repaints within a
  // second. Debounced so a batch of 30 inserts is one refresh.
  try {
    let _rtTimer = null;
    rtSub = supabase.channel('tv_board_sales_rt')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sales' }, () => {
        clearTimeout(_rtTimer);
        _rtTimer = setTimeout(async () => {
          try { if (typeof refreshSalesData === 'function') await refreshSalesData(); } catch (e) { /* poll covers it */ }
          try { render(); } catch (e) { /* keep the board up */ }
        }, 1500);
      })
      .subscribe();
  } catch (e) { rtSub = null; /* realtime unavailable — the poll still runs */ }
}
