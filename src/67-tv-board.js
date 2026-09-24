// ┌─ src/67-tv-board.js ──────────────────────────────────────────────────────
// │ TV Display — the inside-sales floor board (gear menu → TV Display).
// │ Rebuilt Sep 2026 on Cam's RIDDMADE design kit: Deck 2.0 palette (a
// │ lit screen, not paper), Anton headlines, every figure in the mono,
// │ ember spent once — on the number. Same CRM-backed pool as the War Room.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
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
  const RANGES = [['today', 'Today'], ['week', 'This week'], ['month', 'This month'], ['year', 'This year']];
  if (!RANGES.some(r => r[0] === state._tvRange)) state._tvRange = 'today';

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
    if (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4') { state._tvRange = RANGES[Number(e.key) - 1][0]; render(); }
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

  const rangeOf = () => {
    const now = new Date(); const today = iso(now);
    if (state._tvRange === 'week') { const s = new Date(now); s.setDate(s.getDate() - s.getDay()); return { start: iso(s), end: today, label: 'This week' }; }   // Sunday → today (Sun–Sat weeks, same as the rest of the app)
    if (state._tvRange === 'month') { return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: today, label: now.toLocaleDateString('en-US', { month: 'long' }) }; }
    if (state._tvRange === 'year') { return { start: now.getFullYear() + '-01-01', end: today, label: String(now.getFullYear()) }; }
    return { start: today, end: today, label: 'Today' };
  };
  // The comparable slice of the PRIOR period (per Isaac): yesterday; last
  // week Sunday → same weekday; last month 1st → same day; last year
  // Jan 1 → same date. To-date, so mid-period the comparison is fair.
  const priorRangeOf = () => {
    const now = new Date(); const shift = (d, fn) => { const x = new Date(d); fn(x); return x; };
    if (state._tvRange === 'week') { const s = shift(now, x => x.setDate(x.getDate() - x.getDay() - 7)); const e = shift(now, x => x.setDate(x.getDate() - 7)); return { start: iso(s), end: iso(e), label: 'Last week to date' }; }
    if (state._tvRange === 'month') { const s = new Date(now.getFullYear(), now.getMonth() - 1, 1); const e = new Date(now.getFullYear(), now.getMonth() - 1, Math.min(now.getDate(), new Date(now.getFullYear(), now.getMonth(), 0).getDate())); return { start: iso(s), end: iso(e), label: s.toLocaleDateString('en-US', { month: 'long' }) + ' to date' }; }
    if (state._tvRange === 'year') { const e = shift(now, x => x.setFullYear(x.getFullYear() - 1)); return { start: (now.getFullYear() - 1) + '-01-01', end: iso(e), label: (now.getFullYear() - 1) + ' to date' }; }
    const y = shift(now, x => x.setDate(x.getDate() - 1)); return { start: iso(y), end: iso(y), label: 'Yesterday' };
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
    const pool = (typeof dashboardSales === 'function' ? dashboardSales() : (state.allSales || [])) || [];
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
    const subs = rows.filter(s => !isOts(s));
    // Multi-year % (per Isaac): anything sold by the house "RIDD Account"
    // login is out of the ratio (shown in its own column on the drill).
    // "RIDD Account" is an app USER (per Isaac), so the sale carries a rep_id
    // and the CRM name may be blank — resolve the seller's display name the
    // same way the leaderboard does and match on that.
    const _profName = (id) => { if (!id) return ''; const p = (state.allProfiles || []).find(x => x.id === id) || (state.profile && state.profile.id === id ? state.profile : null); return p ? String(p.full_name || p.email || '') : ''; };
    const sellerName = (s) => _profName(s.rep_id) || String(s._crmRep || '');
    // The CRM stores names "Last, First" — "Account, RIDD" — so match on the
    // words, not the order.
    const isHouse = (s) => { const n = sellerName(s).toLowerCase(); return (/\bridd\b/.test(n) && /\baccount\b/.test(n)) || (typeof FR_SYSTEM_NAME_RE !== 'undefined' && FR_SYSTEM_NAME_RE.test(sellerName(s))); };
    // Agent performance, not the automated account (per Isaac): every rate
    // tile runs on rowsAgent / subsMy; the house rows stay in the revenue.
    const rowsAgent = rows.filter(s => !isHouse(s));
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
    const signedOf = (s) => {
      if (s.crm_contract_state) return String(s.crm_contract_state) === 'signed';
      const snap = (s.crm_subscription_id != null && _snapBySub.get(String(s.crm_subscription_id)))
        || (s.customer_number != null && _snapByCustSvc.get(String(s.customer_number) + '|' + String(s._crmService || s.service_name || '').trim().toLowerCase()));
      return snap ? String(snap.contract_state || 'none') === 'signed' : null;
    };
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
      multiPct: my.length ? multi / my.length * 100 : 0, autoPay: ap, signedPct, recMix: rowsAgent.length ? subsMy.length / rowsAgent.length * 100 : 0, reps, offices, latest, goal,
      splits: {
        multi: { yes: subsMyNR.filter(s => (typeof myBucketOf === 'function' ? myBucketOf(s) : null) === 'multi'), no: subsMyNR.filter(s => (typeof myBucketOf === 'function' ? myBucketOf(s) : null) === 'twelve'), excluded: subs.filter(s => isHouse(s) || isRenewal(s)) },
        signed: { yes: sgYes, no: sgNo, excluded: sgExcl },
        autopay: { yes: apPool.filter(s => s._crmAutoPay), no: apPool.filter(s => !s._crmAutoPay), excluded: rows.filter(s => s._crm && isHouse(s)) },
        recmix: { yes: subsMy, no: rowsAgent.filter(s => isOts(s)), excluded: rows.filter(isHouse) },
        // Price-point drills (per Isaac): initial ≥ $99 / under, recurring ≥ $59 / under, ACV ≥ $700 / under.
        initial: { yes: subsMy.filter(s => (Number(s.initial_amount) || 0) >= 99), no: subsMy.filter(s => (Number(s.initial_amount) || 0) < 99), excluded: subs.filter(isHouse) },
        recurring: { yes: subsMy.filter(s => (Number(s.monthly_amount) || 0) >= 59), no: subsMy.filter(s => (Number(s.monthly_amount) || 0) < 59), excluded: subs.filter(isHouse) },
        // ACV (per Isaac): RIDD Account sales and one-time services sit out of the average, in their own column.
        acv: { yes: subsAcv.filter(s => (Number(s.revenue_amount) || 0) >= 700), no: subsAcv.filter(s => (Number(s.revenue_amount) || 0) < 700), excluded: rows.filter(s => isHouse(s) || isOts(s) || isRenewal(s)) },
      } };
  };

  // ── pieces ──
  const eyebrow = (t, extra = {}) => el('div', { style: { fontFamily: MONO, fontSize: '11px', letterSpacing: '.24em', textTransform: 'uppercase', color: T.dim, ...extra } }, t);
  const figure = (v, size, color) => el('div', { style: { fontFamily: MONO, fontSize: size, lineHeight: '1', color: color || T.ink, fontVariantNumeric: 'tabular-nums' } }, v);
  const panel = (children, extra = {}) => { const { onclick, ...st } = extra; return el('div', { style: { background: T.surface, border: '1px solid ' + T.hair, padding: '20px 24px', display: 'flex', flexDirection: 'column', minHeight: '0', ...st }, onclick: onclick || null }, ...children); };
  const tile = (label, value, sub, drill) => el('div', { style: { background: T.surface, border: '1px solid ' + T.hair, padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '6px', minWidth: '0', cursor: drill ? 'pointer' : 'default' }, title: drill ? 'Tap to see what is behind this number' : '', onclick: drill || null },
    eyebrow(label + (drill ? '  ·  tap' : '')), figure(value, 'clamp(22px, 2.2vw, 34px)'));   // (descriptions dropped per Isaac — the room knows what these are)
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
    const list = (label, xs, hot) => el('div', { style: { minWidth: '0', display: 'flex', flexDirection: 'column' } },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '10px' } }, eyebrow(label, { color: hot ? T.ember : T.ink }), eyebrow(xs.length + ' sale' + (xs.length === 1 ? '' : 's') + summary(xs))),
      el('div', { style: { overflow: 'auto', maxHeight: '60vh' } },
        ...(xs.length ? xs.map((x, i) => el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '12px', alignItems: 'baseline', padding: '9px 0', borderTop: i ? '1px solid ' + T.hair : 'none' } },
          el('div', { style: { minWidth: '0' } },
            el('div', { style: { fontFamily: HEAD, fontSize: '18px', letterSpacing: '.02em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, repName(x),
              x.customer_number ? el('span', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.06em', textTransform: 'none', marginLeft: '10px' }, title: 'Customer ID' }, '#' + x.customer_number) : null),
            el('div', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.04em', marginTop: '2px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
              el('span', { style: { color: T.ink } }, (Number(x.contract_months) > 1 ? Number(x.contract_months) + ' MO' : 'ONE-TIME')), '  ·  ' + (x._crmService || x.service_name || '—') + (sourceOf(x) ? '  ·  ' + sourceOf(x) : '') + (saleAt(x) ? '  ·  ' + ago(saleAt(x)) : ''))),
          figure(amtFmt(amtOf(x)), '16px')))
        : [el('div', { style: { fontFamily: MONO, color: T.dim, fontSize: '13px' } }, 'None.')])));
    back.append(el('div', { style: { background: T.surface, border: '1px solid ' + T.hair, color: T.ink, width: 'min(1200px, 94vw)', padding: '26px 30px', display: 'flex', flexDirection: 'column', gap: '18px' } },
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
        hero ? el('div', {}) : el('div', { style: { fontFamily: HEAD, fontSize: '32px', letterSpacing: '.02em', textTransform: 'uppercase' } }, title),
        el('button', { style: { width: '36px', height: '36px', background: 'transparent', border: '1px solid ' + T.hair, color: T.dim, cursor: 'pointer', fontSize: '18px' }, onclick: close }, '\u00d7')),
      hero || null,
      no ? el('div', { style: { display: 'grid', gridTemplateColumns: metric && metric.third ? '1fr 1fr 1fr' : '1fr 1fr', gap: '28px' } }, list(yesLabel, yes, true), list(noLabel, no, false), metric && metric.third ? list(metric.third.label, metric.third.rows, false) : null)
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
        el('div', { style: { display: 'flex', gap: '6px' } }, ...RANGES.map(([id, l]) => pill(id, l))),
        // (header clock retired per Isaac — the stamp on the left carries date + time)
        // (Resync button retired per Isaac, Sep 18 — the snapshot lands every 30 min, the live feed every 15, the board pulls every 5.)
        iconBtn(inFs ? 'Exit fullscreen (F)' : 'Fullscreen (F)', inFs ? '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>' : '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>', toggleFs),
        iconBtn('Close (Esc)', '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', cleanup)));

    // Hero: THE number (ember, Anton, once) + goal bar + the stat tiles.
    const hero = el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: '18px', padding: '18px 36px 0', alignItems: 'stretch', flex: '0 0 auto' } },
      state._tvHeroOffices ? panel([el('div', { style: { position: 'absolute', inset: '20px 24px', display: 'flex', flexDirection: 'column', minHeight: '0' } },
        // Tap-swapped view (per Isaac): the window's NEW revenue by branch,
        // in the SAME footprint as the number (the list scrolls inside).
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, eyebrow(d.range.label + ' · new revenue by branch · bar = new'), eyebrow(money(d.revenue) + ' new · ' + money(d.totalRevenue) + ' total · tap to go back')),
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
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, eyebrow(d.range.label + ' · new revenue'), eyebrow(d.newCount + ' sale' + (d.newCount === 1 ? '' : 's') + ' · tap for branches')),
        el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '22px', flexWrap: 'wrap', marginTop: '6px' } },
          el('div', { class: fresh ? 'tv-pulse' : '', style: { fontFamily: HEAD, fontSize: 'clamp(64px, 6.8vw, 124px)', lineHeight: '.95', letterSpacing: '.01em', color: T.ember, fontVariantNumeric: 'tabular-nums' } }, money(d.revenue)),
          // Prior period at a quarter of the size (per Isaac): yesterday / last week / last month / last year, to date.
          el('div', { style: { display: 'flex', flexDirection: 'column', gap: '4px', paddingBottom: '6px' } },
            eyebrow(d.prior.label),
            el('div', { style: { display: 'flex', alignItems: 'baseline', gap: '10px' } },
              figure(money(d.priorRevenue), 'clamp(16px, 1.7vw, 31px)', T.dim),
              d.priorRevenue > 0 ? el('span', { style: { fontFamily: MONO, fontSize: '11px', letterSpacing: '.06em', color: d.revenue >= d.priorRevenue ? T.ember : T.dim } }, (d.revenue >= d.priorRevenue ? '+' : '−') + Math.round(Math.abs(d.revenue - d.priorRevenue) / d.priorRevenue * 100) + '%') : null))),
        // Total and renewal, minimally (per Isaac) — the headline stays NEW.
        el('div', { style: { display: 'flex', gap: '28px', marginTop: '10px', flexWrap: 'wrap' } },
          el('div', {}, eyebrow('Total'), figure(money(d.totalRevenue), 'clamp(16px, 1.4vw, 22px)', T.ink)),
          el('div', {}, eyebrow('Renewal'), figure(money(d.renewalRevenue) + (d.renewalCount ? '  ·  ' + d.renewalCount : ''), 'clamp(16px, 1.4vw, 22px)', T.dim))),
        el('div', { style: { marginTop: 'auto', paddingTop: '12px' } },
          el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' } },
            eyebrow(d.goal > 0 ? d.range.label + ' goal ' + money(d.goal) : 'No goal set'),
            d.goal > 0 ? el('div', { style: { fontFamily: MONO, fontSize: '13px', color: goalPct >= 1 ? T.ember : T.ink, letterSpacing: '.06em' } }, Math.round(goalPct * 100) + '%' + (d.revenue >= d.goal ? '  ·  GOAL HIT' : '  ·  ' + money(d.goal - d.revenue) + ' to go')) : null),
          el('div', { style: { height: '6px', background: T.surface2, position: 'relative' } },
            el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: ((goalPct || 0) * 100) + '%', background: T.ember, transition: 'width .6s ease' } })))], { cursor: 'pointer', onclick: () => { state._tvHeroOffices = true; render(); } }),
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: '1fr', gap: '10px', minWidth: '0' } },
        // Layout (per Isaac, Sep 24): [Avg initial | Avg recurring] · Avg ACV /
        // Multi-year · Auto pay / Signed agreement · Rec mix.
        el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', minWidth: '0' } },
          tile('Avg initial', money(d.avgInitial), 'subscriptions', () => openDrill('Avg initial · ' + money(d.avgInitial), 'Initial $99 and up', d.splits.initial.yes, 'Initial under $99', d.splits.initial.no, repNameOf, null, { of: (x) => Number(x.initial_amount) || 0, fmt: money, third: { label: 'Excluded · RIDD Account', rows: d.splits.initial.excluded } })),
          tile('Avg recurring', money(d.avgMonthly), 'per month', () => openDrill('Avg recurring · ' + money(d.avgMonthly), 'Recurring $59 and up', d.splits.recurring.yes, 'Recurring under $59', d.splits.recurring.no, repNameOf, null, { of: (x) => Number(x.monthly_amount) || 0, fmt: (n) => money(n) + '/mo', third: { label: 'Excluded · RIDD Account', rows: d.splits.recurring.excluded } }))),
        tile('Avg ACV', money(d.avgContract), 'contract value per sale', () => openDrill('Avg ACV · ' + money(d.avgContract), 'ACV $700 and up', d.splits.acv.yes, 'ACV under $700', d.splits.acv.no, repNameOf, null, { of: (x) => Number(x.revenue_amount) || 0, fmt: money, third: { label: 'Excluded · RIDD Account, one-time, renewals', rows: d.splits.acv.excluded } })),
        tile('Multi-year', pct(d.multiPct), '18 mo and up', () => openDrill('Multi-year · ' + pct(d.multiPct), 'Multi-year (18 mo+)', d.splits.multi.yes, '12-month', d.splits.multi.no, repNameOf, null, { of: (x) => Number(x.contract_months) || 0, fmt: (n) => n > 1 ? Math.round(n) + ' MO' : 'ONE-TIME', avg: false, third: { label: 'Excluded · RIDD Account, renewals', rows: d.splits.multi.excluded } })),
        tile('Auto pay', d.autoPay == null ? '—' : pct(d.autoPay * 100), 'of CRM sales', () => openDrill('Auto pay · ' + (d.autoPay == null ? '—' : pct(d.autoPay * 100)), 'On auto pay', d.splits.autopay.yes, 'Not on auto pay', d.splits.autopay.no, repNameOf, null, { of: (x) => Number(x.revenue_amount) || 0, fmt: money, avg: false, third: { label: 'Excluded · RIDD Account', rows: d.splits.autopay.excluded } })),
        tile('Signed agreement', d.signedPct == null ? '—' : pct(d.signedPct), 'every agent sale', () => openDrill('Signed agreement · ' + (d.signedPct == null ? '—' : pct(d.signedPct)), 'Signed', d.splits.signed.yes, 'Not signed', d.splits.signed.no, repNameOf, null, { of: (x) => Number(x.revenue_amount) || 0, fmt: money, avg: false, third: { label: 'Excluded · RIDD Account, not synced yet', rows: d.splits.signed.excluded } })),
        tile('Rec mix', pct(d.recMix), 'recurring subs of all sales', () => openDrill('Rec mix · ' + pct(d.recMix), 'Recurring subscriptions', d.splits.recmix.yes, 'One-time services', d.splits.recmix.no, repNameOf, null, { of: (x) => Number(x.revenue_amount) || 0, fmt: money, avg: false, third: { label: 'Excluded · RIDD Account', rows: d.splits.recmix.excluded } }))));

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
            el('div', { style: { minWidth: '0' } },
              el('div', { style: { display: 'flex', alignItems: 'baseline', minWidth: '0', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                el('span', { style: { fontFamily: HEAD, fontSize: 'clamp(17px, 1.35vw, 22px)', letterSpacing: '.02em', textTransform: 'uppercase' } }, (r ? r.name : (s._crmRep || 'Rep'))),
                // Customer ID first (per Isaac, Sep 22): NAME | #id | service | term | source.
                s.customer_number ? sep() : null, s.customer_number ? el('span', { style: { fontFamily: MONO, fontSize: 'clamp(11px, .85vw, 13px)', color: T.dim, letterSpacing: '.06em' }, title: 'Customer ID' }, '#' + s.customer_number) : null,
                sep(), el('span', { style: { fontFamily: VOICE, fontWeight: 600, fontSize: 'clamp(12px, .95vw, 15px)', color: T.ink } }, s._crmService || s.service_name || '—'),
                sep(), el('span', { style: { fontFamily: VOICE, fontWeight: 600, fontSize: 'clamp(12px, .95vw, 15px)', color: T.ink } }, (Number(s.contract_months) > 1 ? Number(s.contract_months) + ' MO' : 'ONE-TIME')),
                src ? sep() : null, src ? el('span', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.04em' } }, src) : null),
              el('div', { style: { fontFamily: MONO, fontSize: '10px', color: T.dim, letterSpacing: '.06em', marginTop: '2px', whiteSpace: 'nowrap' } }, at ? when(at) : '—')),
            figure(money(s.revenue_amount), 'clamp(17px, 1.5vw, 24px)', T.ink));
        }) : [el('div', { style: { fontFamily: MONO, color: T.dim, fontSize: '13px' } }, 'Nothing yet.')]))], { flex: '1' });
    const body = el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gridTemplateRows: 'minmax(0, 1fr)', gap: '18px', padding: '20px 36px 24px', flex: '1', minHeight: '0' } },
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
  // Refresh the CRM pool in the background so the board keeps up with the sync.
  const pullFresh = async () => {
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
