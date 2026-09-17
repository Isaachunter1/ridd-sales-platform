// ┌─ src/67-tv-board.js ──────────────────────────────────────────────────────
// │ TV Display — the inside-sales floor board (gear menu → TV Display).
// │ Rebuilt Sep 2026 on Cam's RIDDMADE design kit: Deck 2.0 palette (a
// │ lit screen, not paper), Anton headlines, every figure in the mono,
// │ ember spent once — on the number. Same CRM-backed pool as the War Room.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function openTvBoard() {
  // Deck 2.0 tokens (docs/design-kit/BRAND.md) — scoped to the board.
  const T = { void: '#0A0B0D', surface: '#14161A', surface2: '#1E2128', hair: '#2B2F38', ink: '#F4F6F8', dim: '#9AA2B1', ember: '#FF5F2E' };
  const MONO = "'IBM Plex Mono', ui-monospace, SFMono-Regular, Menlo, monospace";
  const HEAD = "'Anton', 'Archivo', ui-sans-serif, system-ui, sans-serif";
  const VOICE = "'Archivo', ui-sans-serif, system-ui, sans-serif";
  const EXCLUDED = new Set(['cancelled', 'nsf', 'not_payable', 'reschedule', 'rejected']);
  const RANGES = [['today', 'Today'], ['week', 'This week'], ['month', 'This month']];
  if (!RANGES.some(r => r[0] === state._tvRange)) state._tvRange = 'today';

  const overlay = el('div', { style: { position: 'fixed', inset: '0', background: T.void, color: T.ink, zIndex: '9999', overflow: 'hidden', fontFamily: VOICE } });
  let timers = [];
  let lastKeys = null;   // sale ids seen on the previous paint → pulse on a new one
  const cleanup = () => {
    timers.forEach(clearInterval); timers = [];
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('fullscreenchange', onFs);
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    overlay.remove();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { if (!document.fullscreenElement) cleanup(); return; }
    if (e.key === '1' || e.key === '2' || e.key === '3') { state._tvRange = RANGES[Number(e.key) - 1][0]; render(); }
    if (e.key === 'f' || e.key === 'F') toggleFs();
  };
  const toggleFs = () => { if (document.fullscreenElement) document.exitFullscreen().catch(() => {}); else overlay.requestFullscreen?.().catch(() => {}); };
  // (listeners are attached after render() exists — a const can't be
  // referenced before its line, which is what made the first cut a no-op.)
  const onFs = () => { try { render(); } catch (e) { /* keep the board up */ } };

  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const localDay = (v) => { if (!v) return null; const d = new Date(v); return isNaN(d) ? null : iso(d); };
  const money = (n) => '$' + Math.round(n || 0).toLocaleString('en-US');
  const pct = (n) => (Math.round((n || 0) * 10) / 10).toFixed(1) + '%';
  const isSellingDay = (d) => { const w = d.getDay(); if (w === 0 || w === 6) return false; return !(typeof companyHolidayFor === 'function' && companyHolidayFor(iso(d))); };

  const rangeOf = () => {
    const now = new Date(); const today = iso(now);
    if (state._tvRange === 'week') { const s = new Date(now); s.setDate(s.getDate() - ((s.getDay() + 6) % 7)); return { start: iso(s), end: today, label: 'This week' }; }   // Monday → today
    if (state._tvRange === 'month') { return { start: iso(new Date(now.getFullYear(), now.getMonth(), 1)), end: today, label: now.toLocaleDateString('en-US', { month: 'long' }) }; }
    return { start: today, end: today, label: 'Today' };
  };
  // Goal for the window: the Goals tab's monthly allocation (new + renewal,
  // else the annual spread evenly) over the month's selling days.
  const goalFor = (range) => {
    const g = state.companyGoal || {};
    const monthTarget = (mi) => {
      const mn = Array.isArray(g.monthly_new) && g.monthly_new.length === 12 ? Number(g.monthly_new[mi]) || 0 : 0;
      const mr = Array.isArray(g.monthly_renewal) && g.monthly_renewal.length === 12 ? Number(g.monthly_renewal[mi]) || 0 : 0;
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

  const compute = () => {
    const range = rangeOf();
    const pool = (typeof dashboardSales === 'function' ? dashboardSales() : (state.allSales || [])) || [];
    const rows = pool.filter(s => { if (EXCLUDED.has(s.audit_status)) return false; const day = localDay(s.created_at) || s.sold_date; return day && day >= range.start && day <= range.end; });
    const rev = (xs) => xs.reduce((a, s) => a + (Number(s.revenue_amount) || 0), 0);
    const isOts = (s) => s._crm ? (!/sentricon/i.test(String(s._crmService || '')) && !(Number(s.contract_months) > 1)) : new Set([4, 5]).has(Number(s.contract_type_id));
    const subs = rows.filter(s => !isOts(s));
    const my = subs.map(s => (typeof myBucketOf === 'function') ? myBucketOf(s) : null).filter(Boolean);
    const multi = my.filter(b => b === 'multi').length;
    const ap = rows.filter(s => s._crm).length ? rows.filter(s => s._crm && s._crmAutoPay).length / rows.filter(s => s._crm).length : null;
    // Reps — CRM sellers without an app account rank under their CRM name.
    const agg = new Map();
    rows.forEach(s => {
      const key = s.rep_id || (s._crm && s._crmRep && !(typeof FR_SYSTEM_NAME_RE !== 'undefined' && FR_SYSTEM_NAME_RE.test(s._crmRep)) ? 'crm:' + s._crmRep : null);
      if (!key) return;
      if (!agg.has(key)) agg.set(key, { key, id: s.rep_id, crm: s._crmRep, revenue: 0, count: 0, last: null });
      const a = agg.get(key); a.revenue += Number(s.revenue_amount) || 0; a.count++;
      if (!a.last || String(s.created_at) > String(a.last)) a.last = s.created_at;
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
    rows.forEach(s => { const o = (state.offices || []).find(x => x.id === s.office_id); const n = o ? o.name : (s._crmOffice || 'Unassigned'); offAgg.set(n, (offAgg.get(n) || 0) + (Number(s.revenue_amount) || 0)); });
    const offices = [...offAgg.entries()].map(([name, revenue]) => ({ name, revenue })).sort((a, b) => b.revenue - a.revenue);
    const latest = [...rows].sort((a, b) => String(b.created_at || b.sold_date).localeCompare(String(a.created_at || a.sold_date))).slice(0, 8);
    const goal = goalFor(range);
    return { range, rows, revenue: rev(rows), count: rows.length,
      avgInitial: subs.length ? subs.reduce((a, s) => a + (Number(s.initial_amount) || 0), 0) / subs.length : 0,
      avgMonthly: subs.length ? subs.reduce((a, s) => a + (Number(s.monthly_amount) || 0), 0) / subs.length : 0,
      avgContract: rows.length ? rev(rows) / rows.length : 0,
      multiPct: my.length ? multi / my.length * 100 : 0, autoPay: ap, recMix: rows.length ? subs.length / rows.length * 100 : 0, reps, offices, latest, goal };
  };

  // ── pieces ──
  const eyebrow = (t, extra = {}) => el('div', { style: { fontFamily: MONO, fontSize: '11px', letterSpacing: '.24em', textTransform: 'uppercase', color: T.dim, ...extra } }, t);
  const figure = (v, size, color) => el('div', { style: { fontFamily: MONO, fontSize: size, lineHeight: '1', color: color || T.ink, fontVariantNumeric: 'tabular-nums' } }, v);
  const panel = (children, extra = {}) => el('div', { style: { background: T.surface, border: '1px solid ' + T.hair, padding: '22px 24px', display: 'flex', flexDirection: 'column', minHeight: '0', ...extra } }, ...children);
  const tile = (label, value, sub) => el('div', { style: { background: T.surface, border: '1px solid ' + T.hair, padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: '10px', minWidth: '0' } },
    eyebrow(label), figure(value, 'clamp(26px, 2.6vw, 40px)'), sub ? el('div', { style: { fontFamily: MONO, fontSize: '11px', color: T.dim, letterSpacing: '.06em' } }, sub) : null);
  const avatar = (r, px) => r.avatar
    ? el('img', { src: r.avatar, alt: '', style: { width: px + 'px', height: px + 'px', objectFit: 'cover', flexShrink: '0', filter: 'grayscale(1) contrast(1.1)' } })
    : el('div', { style: { width: px + 'px', height: px + 'px', flexShrink: '0', background: T.surface2, color: T.ink, display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: HEAD, fontSize: Math.round(px * .42) + 'px', letterSpacing: '.04em' } }, r.initials);
  const ago = (v) => { const d = new Date(v); if (isNaN(d)) return ''; const m = Math.max(0, Math.round((Date.now() - d) / 60000)); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' hr ago' : Math.round(m / 1440) + ' d ago'; };

  const render = () => {
    const d = compute();
    const keys = new Set(d.rows.map(s => s.id));
    const fresh = lastKeys ? [...keys].some(k => !lastKeys.has(k)) : false;
    lastKeys = keys;
    const inFs = !!document.fullscreenElement;
    const leader = d.reps[0];
    const maxRev = leader ? leader.revenue : 0;
    const goalPct = d.goal > 0 ? Math.min(1, d.revenue / d.goal) : null;

    // Header: wordmark · INSIDE SALES · range pills · clock · fullscreen · close
    const clock = el('div', { style: { fontFamily: MONO, fontSize: '13px', letterSpacing: '.12em', color: T.dim } });
    const tick = () => { clock.textContent = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }).toUpperCase() + '  ·  ' + new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase(); };
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
        eyebrow(((typeof appSyncStampStr === 'function' && appSyncStampStr()) ? String(appSyncStampStr()).replace(/^last sync:?\s*/i, 'Synced ') : 'Sync —') + '  ·  refreshed ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))),
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '18px' } },
        el('div', { style: { display: 'flex', gap: '6px' } }, ...RANGES.map(([id, l]) => pill(id, l))),
        clock,
        (() => {
          // Resync: kicks the server-side FieldRoutes → snapshot job (1–2 min),
          // the board pulls the fresh dataset in on its own when it lands.
          const b = el('button', { title: 'Pull fresh numbers from FieldRoutes now', style: { fontFamily: MONO, fontSize: '11px', letterSpacing: '.18em', textTransform: 'uppercase', padding: '8px 12px', background: 'transparent', color: state._revhawkSyncing ? T.ember : T.dim, border: '1px solid ' + (state._revhawkSyncing ? T.ember : T.hair), cursor: 'pointer' } }, state._revhawkSyncing ? 'Syncing…' : 'Resync');
          b.onclick = async () => { try { if (typeof syncFromRevHawk === 'function') { b.textContent = 'Syncing…'; b.style.color = T.ember; b.style.borderColor = T.ember; await syncFromRevHawk(null); } } catch (e) { /* toast already shown */ } finally { setTimeout(render, 1500); } };
          return b;
        })(),
        iconBtn(inFs ? 'Exit fullscreen (F)' : 'Fullscreen (F)', inFs ? '<path d="M8 3v3a2 2 0 0 1-2 2H3"/><path d="M21 8h-3a2 2 0 0 1-2-2V3"/><path d="M3 16h3a2 2 0 0 1 2 2v3"/><path d="M16 21v-3a2 2 0 0 1 2-2h3"/>' : '<path d="M8 3H5a2 2 0 0 0-2 2v3"/><path d="M21 8V5a2 2 0 0 0-2-2h-3"/><path d="M3 16v3a2 2 0 0 0 2 2h3"/><path d="M16 21h3a2 2 0 0 0 2-2v-3"/>', toggleFs),
        iconBtn('Close (Esc)', '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>', cleanup)));

    // Hero: THE number (ember, Anton, once) + goal bar + the stat tiles.
    const hero = el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: '18px', padding: '22px 36px 0', alignItems: 'stretch' } },
      panel([
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' } }, eyebrow(d.range.label + ' · revenue'), eyebrow(d.count + ' sale' + (d.count === 1 ? '' : 's'))),
        el('div', { class: fresh ? 'tv-pulse' : '', style: { fontFamily: HEAD, fontSize: 'clamp(84px, 9.5vw, 172px)', lineHeight: '.95', letterSpacing: '.01em', color: T.ember, marginTop: '10px', fontVariantNumeric: 'tabular-nums' } }, money(d.revenue)),
        el('div', { style: { marginTop: 'auto', paddingTop: '18px' } },
          el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '8px' } },
            eyebrow(d.goal > 0 ? d.range.label + ' goal ' + money(d.goal) : 'No goal set'),
            d.goal > 0 ? el('div', { style: { fontFamily: MONO, fontSize: '13px', color: goalPct >= 1 ? T.ember : T.ink, letterSpacing: '.06em' } }, Math.round(goalPct * 100) + '%' + (d.revenue >= d.goal ? '  ·  GOAL HIT' : '  ·  ' + money(d.goal - d.revenue) + ' to go')) : null),
          el('div', { style: { height: '6px', background: T.surface2, position: 'relative' } },
            el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: ((goalPct || 0) * 100) + '%', background: goalPct >= 1 ? T.ember : T.ink, transition: 'width .6s ease' } })))]),
      el('div', { style: { display: 'grid', gridTemplateColumns: '1fr 1fr', gridAutoRows: '1fr', gap: '12px', minWidth: '0' } },
        tile('Avg initial', money(d.avgInitial), 'subscriptions'),
        tile('Avg recurring', money(d.avgMonthly), 'per month'),
        tile('Avg ACV', money(d.avgContract), 'contract value per sale'),
        tile('Multi-year', pct(d.multiPct), '18 mo and up'),
        tile('Auto pay', d.autoPay == null ? '—' : pct(d.autoPay * 100), 'of CRM sales'),
        tile('Rec mix', pct(d.recMix), 'recurring subs of all sales')));

    // Body: leaderboard | offices + latest
    const board = panel([
      el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '14px' } }, eyebrow('Leaderboard'), eyebrow('revenue · sales')),
      d.reps.length ? el('div', { style: { display: 'flex', flexDirection: 'column', gap: '6px', overflow: 'hidden', flex: '1' } },
        ...d.reps.slice(0, 10).map((r, i) => el('div', { style: { display: 'grid', gridTemplateColumns: '44px 56px minmax(0, 1fr) auto', alignItems: 'center', gap: '16px', padding: '8px 10px', background: i === 0 ? T.surface2 : 'transparent', borderLeft: i === 0 ? '3px solid ' + T.ember : '3px solid transparent' } },
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
      eyebrow('Latest sales'),
      el('div', { style: { display: 'flex', flexDirection: 'column', marginTop: '10px', overflow: 'hidden', flex: '1' } },
        ...(d.latest.length ? d.latest.map((s, i) => {
          const r = d.reps.find(x => x.key === (s.rep_id || ('crm:' + s._crmRep)));
          return el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto', gap: '12px', alignItems: 'baseline', padding: '12px 0', borderTop: i ? '1px solid ' + T.hair : 'none' } },
            el('div', { style: { minWidth: '0' } },
              el('div', { style: { fontFamily: HEAD, fontSize: 'clamp(18px, 1.5vw, 24px)', letterSpacing: '.02em', textTransform: 'uppercase', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } }, (r ? r.name : (s._crmRep || 'Rep'))),
              el('div', { style: { fontFamily: MONO, fontSize: '12px', color: T.dim, letterSpacing: '.04em', marginTop: '3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' } },
                el('span', { style: { color: T.ink } }, (Number(s.contract_months) > 1 ? Number(s.contract_months) + ' MO' : 'ONE-TIME')), '  ·  ' + (s._crmService || s.service_name || '—') + (s.created_at ? '  ·  ' + ago(s.created_at) : ''))),
            figure(money(s.revenue_amount), 'clamp(18px, 1.6vw, 26px)', i === 0 && fresh ? T.ember : T.ink));
        }) : [el('div', { style: { fontFamily: MONO, color: T.dim, fontSize: '13px' } }, 'Nothing yet.')]))], { flex: '1' });
    const body = el('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0, 1.25fr) minmax(0, 1fr)', gap: '18px', padding: '18px 36px 28px', flex: '1', minHeight: '0' } },
      board,
      latestEl);   // (By branch retired per Isaac — the column is the latest sales.)

    const foot = el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '0 36px 16px', fontFamily: MONO, fontSize: '10px', letterSpacing: '.18em', textTransform: 'uppercase', color: T.dim } },
      el('span', {}, 'Live from FieldRoutes · ' + ((typeof appSyncStampStr === 'function') ? appSyncStampStr() : '')),
      el('span', {}, '1 · 2 · 3 range   F fullscreen   Esc close'));

    overlay.replaceChildren(el('div', { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: '0' } }, header, hero, body, foot));
    timers.forEach(clearInterval); timers = [];
    timers.push(setInterval(tick, 15000));
    timers.push(setInterval(() => { try { render(); } catch (e) { /* keep the board up */ } }, 30000));
  };
  if (!document.getElementById('tv-board-css')) {
    const st = document.createElement('style'); st.id = 'tv-board-css';
    st.textContent = '@keyframes tvPulse{0%{opacity:.35;transform:translateY(6px)}100%{opacity:1;transform:none}} .tv-pulse{animation:tvPulse .7s cubic-bezier(.16,1,.3,1) both} @media (prefers-reduced-motion: reduce){.tv-pulse{animation:none}}';
    document.head.append(st);
  }
  document.addEventListener('keydown', onKey);
  document.addEventListener('fullscreenchange', onFs);
  document.body.append(overlay);
  render();
  // Refresh the CRM pool in the background so the board keeps up with the sync.
  timers.push(setInterval(() => { try { if (typeof refreshIndicatorsFromCloud === 'function') refreshIndicatorsFromCloud(true); } catch (e) { /* poll retries */ } }, 5 * 60000));
}
