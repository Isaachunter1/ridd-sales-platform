// ┌─ src/72-marketing.js ─────────────────────────────────────────────────────
// │ Marketing command center (ad spend, CAC, ROAS).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function viewMarketing() {
  if (!isAdminRole(state.profile?.role)) {
    return el('div', { class: 'card p-6 text-center text-sm text-muted-' }, 'Marketing is an admin-only tab.');
  }
  const wrap = el('div', { class: 'flex flex-col gap-4 w-full' });

  // ── Feeds (↻ Refresh busts the browser + CDN caches with a query param) ──
  const _bust = state._mkBust ? ('?_=' + state._mkBust) : '';
  const spendSlot = _mkFetch('_mkSpend', '/api/marketing-spend' + _bust);   // { spendDaily: { ymd: [meta, google] } }
  const leadsSlot = _mkFetch('_mkLeads', '/api/ghl-leads' + _bust);         // { leadsBySource, bySourceMonth, total }
  const qboSlot   = _mkFetch('_mkQbo',   '/api/qbo-spend' + _bust);         // { bySourceMonth: { ym: { name: $ } } }

  // ── Period picker ──
  const PERIODS = [['this_month', 'This Month'], ['last_month', 'Last Month'], ['last_90', 'Last 90 Days'], ['ytd', 'YTD']];
  const period = state._mkPeriod || 'this_month';
  const now = new Date(); now.setHours(0, 0, 0, 0);
  const p0 = new Date(now), p1 = new Date(now);
  if (period === 'this_month') { p0.setDate(1); }
  else if (period === 'last_month') { p0.setMonth(p0.getMonth() - 1, 1); p1.setDate(0); }
  else if (period === 'last_90') { p0.setDate(p0.getDate() - 89); }
  else { p0.setMonth(0, 1); }
  const inPeriod = (d) => d && d >= p0 && d <= p1;
  const ymdOf = (d) => d.toISOString().slice(0, 10);

  // ── Revenue & accounts by FR source (marketing = every non-D2D-knock source) ──
  const bySource = {};   // src → { revenue, accounts }
  let mkRevenue = 0, mkAccounts = 0;
  for (const s of (state._indicatorRawSales || [])) {
    if (!frPendingServiced(s)) continue;
    const src = String(s.source || '').trim();
    if (!src || /^door to door$/i.test(src)) continue;               // knocked sales aren't marketing
    const d = _parseIndicatorDay(s);
    if (!inPeriod(d)) continue;
    const cv = Number(s.contractValue) || 0;
    const e = bySource[src] || (bySource[src] = { revenue: 0, accounts: 0 });
    e.revenue += cv; e.accounts += 1;
    mkRevenue += cv; mkAccounts += 1;
  }

  // ── Spend in period (Windsor daily: [meta, google]) ──
  const spendDaily = (spendSlot.data && spendSlot.data.spendDaily) || null;
  let metaSpend = 0, googleSpend = 0;
  if (spendDaily) for (const [day, pair] of Object.entries(spendDaily)) {
    const d = new Date(day + 'T00:00');
    if (!inPeriod(d)) continue;
    metaSpend += Number(pair[0]) || 0; googleSpend += Number(pair[1]) || 0;
  }
  const adSpend = metaSpend + googleSpend;

  // ── Leads in period (GHL bySourceMonth) ──
  const _mkGhlChannel = (name) => {
    const n = String(name || '').toLowerCase();
    if (/goog|gclid|adwords|paid ?search|gls|lsa/.test(n)) return 'google';
    if (/face|fb|meta|instagram/.test(n)) return 'meta';
    return n || 'other';
  };
  const leadsByChannel = { google: 0, meta: 0 };
  let mkLeads = 0;
  const bySrcMonth = (leadsSlot.data && leadsSlot.data.bySourceMonth) || null;
  if (bySrcMonth) for (const [ym, sources] of Object.entries(bySrcMonth)) {
    const mEnd = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0);
    const mStart = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
    if (mEnd < p0 || mStart > p1) continue;
    for (const [src, n] of Object.entries(sources)) {
      const c = _mkGhlChannel(src);
      leadsByChannel[c] = (leadsByChannel[c] || 0) + (Number(n) || 0);
      mkLeads += Number(n) || 0;
    }
  }

  // ── Channel rows: paid channels first (spend↔source mapped), then every
  // other FR source revenue-only, sorted by revenue ──
  const srcNamed = (names) => names.reduce((a, n) => {
    const hit = Object.keys(bySource).find(k => k.toLowerCase() === n.toLowerCase());
    if (hit) { a.revenue += bySource[hit].revenue; a.accounts += bySource[hit].accounts; a.used.add(hit); }
    return a;
  }, { revenue: 0, accounts: 0, used: new Set() });
  const paidDefs = [
    { key: 'google', label: 'Google Ads', spend: googleSpend, fr: ['Google Ads'], leads: leadsByChannel.google || 0 },
    { key: 'meta',   label: 'Meta (FB/IG)', spend: metaSpend, fr: ['Facebook', 'Facebook Lead'], leads: leadsByChannel.meta || 0 },
  ];
  const usedSources = new Set();
  const channelRows = paidDefs.map(def => {
    const m = srcNamed(def.fr);
    m.used.forEach(u => usedSources.add(u));
    return { label: def.label, paid: true, spend: def.spend, leads: def.leads, revenue: m.revenue, accounts: m.accounts };
  });
  Object.entries(bySource)
    .filter(([src]) => !usedSources.has(src))
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .forEach(([src, m]) => {
      const chLeads = bySrcMonth ? (() => {
        let n = 0;
        for (const [ym, sources] of Object.entries(bySrcMonth)) {
          const mEnd = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0);
          const mStart = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
          if (mEnd < p0 || mStart > p1) continue;
          for (const [gs, c] of Object.entries(sources)) if (gs.toLowerCase() === src.toLowerCase()) n += Number(c) || 0;
        }
        return n;
      })() : 0;
      channelRows.push({ label: src, paid: false, spend: null, leads: chLeads, revenue: m.revenue, accounts: m.accounts });
    });

  // ── QBO books (marketing expense by month) ──
  const qboMonths = (qboSlot.data && (qboSlot.data.bySourceMonth || qboSlot.data.spend)) || null;
  let qboSpend = 0;
  if (qboMonths) for (const [ym, entries] of Object.entries(qboMonths)) {
    if (!/^\d{4}-\d{2}$/.test(ym)) continue;
    const mEnd = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0);
    const mStart = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
    if (mEnd < p0 || mStart > p1) continue;
    for (const v of Object.values(entries)) qboSpend += Number(v) || 0;
  }

  // ── Render helpers ──
  const money0 = (n) => '$' + Math.round(n || 0).toLocaleString();
  const kpi = (label, val, sub, color) => el('div', { class: 'card p-4' },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label),
    el('div', { class: 'text-2xl font-bold tabular-nums mt-1', style: color ? { color } : {} }, val),
    sub ? el('div', { class: 'text-[10px] mt-0.5', style: { color: 'var(--text-muted)' } }, sub) : null);
  const feedNote = (slot, name, hint) => slot.err
    ? el('div', { class: 'text-[10px] mt-1', style: { color: '#B45309' } }, '⚠ ' + name + ' feed: ' + slot.err + (hint ? ' — ' + hint : ''))
    : (!slot.data && slot.inflight !== false ? el('div', { class: 'text-[10px] mt-1', style: { color: 'var(--text-subtle)' } }, name + ' loading…') : null);

  // ── Header: title + period picker ──
  wrap.append(el('div', { class: 'flex items-center justify-between flex-wrap gap-2' },
    el('div', {},
      el('h2', { class: 'text-xl font-bold' }, 'Marketing Pulse'),
      el('p', { class: 'text-xs', style: { color: 'var(--text-muted)' } },
        'Live: FieldRoutes revenue · Windsor ad spend · GoHighLevel leads · QuickBooks books')),
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('div', { class: 'inline-flex rounded-xl border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
        ...PERIODS.map(([k, lab]) => el('button', {
          class: 'px-2.5 py-1 text-[11px] font-semibold transition',
          style: period === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text)' },
          onclick: () => { state._mkPeriod = k; mountApp(); },
        }, lab))),
      el('button', {
        class: 'px-2.5 py-1 text-[11px] font-bold rounded-xl border transition hover:brightness-95',
        style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
        title: 'Force-refresh all three feeds right now (bypasses the 30–60 min caches)',
        onclick: () => { state._mkSpend = state._mkLeads = state._mkQbo = null; state._mkBust = Date.now(); mountApp(); },
      }, '↻ Refresh'))));
  // Pulled-at stamps — so it's always obvious how fresh each feed is.
  (() => {
    const stamp = (slot, name) => slot.data && slot.data.pulledAt
      ? name + ' ' + new Date(slot.data.pulledAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
      : null;
    const parts = [stamp(spendSlot, 'Windsor'), stamp(leadsSlot, 'GHL'), stamp(qboSlot, 'QuickBooks')].filter(Boolean);
    if (parts.length) wrap.append(el('div', { class: 'text-[10px] -mt-2', style: { color: 'var(--text-subtle)' } },
      'Feeds pulled: ' + parts.join(' · ') + ' — FieldRoutes revenue syncs every 30 min on its own'));
  })();

  // ── KPI strip ──
  const cpa = mkAccounts > 0 && adSpend > 0 ? adSpend / mkAccounts : 0;
  const roas = adSpend > 0 ? mkRevenue / adSpend : 0;
  const conv = mkLeads > 0 ? mkAccounts / mkLeads : 0;
  wrap.append(el('div', { class: 'grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3' },
    kpi('Ad Spend', spendDaily ? money0(adSpend) : '—', spendDaily ? 'Meta ' + money0(metaSpend) + ' · Google ' + money0(googleSpend) : 'Windsor feed'),
    kpi('Marketed Revenue', money0(mkRevenue), mkAccounts + ' accounts · non-D2D sources'),
    kpi('Blended CPA', cpa ? money0(cpa) : '—', 'ad spend ÷ marketed accounts'),
    kpi('ROAS', roas ? roas.toFixed(1) + '×' : '—', 'marketed revenue ÷ ad spend', roas >= 3 ? '#DF643A' : roas > 0 ? '#B45309' : null),
    kpi('Leads', bySrcMonth ? mkLeads.toLocaleString() : '—', 'GoHighLevel'),
    kpi('Lead → Sale', conv ? (conv * 100).toFixed(1) + '%' : '—', 'accounts ÷ leads')));
  const feedNotes = el('div', {}, feedNote(spendSlot, 'Windsor', 'set WINDSOR_API_KEY in Netlify'), feedNote(leadsSlot, 'GoHighLevel', 'set GHL_PRIVATE_TOKEN + GHL_LOCATION_ID'), feedNote(qboSlot, 'QuickBooks', 'finish the QBO OAuth setup in qbo-spend.js'));
  if (feedNotes.childNodes.length) wrap.append(feedNotes);

  // ── Channel P&L table ──
  wrap.append(el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b flex items-center justify-between', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, 'Channel P&L'),
      el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'spend = platform-reported (Windsor) · revenue = FieldRoutes contract value, Pending/Serviced')),
    el('div', { class: 'overflow-x-auto' },
      el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[9px] uppercase tracking-wider', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } },
          el('tr', {},
            el('th', { class: 'text-left px-4 py-2.5' }, 'Channel'),
            el('th', { class: 'text-right px-2 py-2.5' }, 'Spend'),
            el('th', { class: 'text-right px-2 py-2.5' }, 'Leads'),
            el('th', { class: 'text-right px-2 py-2.5' }, 'Accounts'),
            el('th', { class: 'text-right px-2 py-2.5' }, 'Revenue'),
            el('th', { class: 'text-right px-2 py-2.5', title: 'Spend ÷ leads' }, 'CPL'),
            el('th', { class: 'text-right px-2 py-2.5', title: 'Spend ÷ accounts sold' }, 'CPA'),
            el('th', { class: 'text-right px-4 py-2.5', title: 'Revenue ÷ spend' }, 'ROAS'))),
        el('tbody', {},
          ...channelRows.map(r => {
            const rCpl = r.spend && r.leads ? r.spend / r.leads : null;
            const rCpa = r.spend && r.accounts ? r.spend / r.accounts : null;
            const rRoas = r.spend ? (r.revenue / r.spend) : null;
            return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-4 py-2.5 font-semibold whitespace-nowrap' }, r.label,
                r.paid ? el('span', { class: 'ml-2 text-[9px] font-bold uppercase px-1.5 py-0.5 rounded', style: { background: 'rgba(59,130,246,.12)', color: '#2563EB' } }, 'paid') : null),
              el('td', { class: 'px-2 py-2.5 text-right tabular-nums' }, r.spend != null ? money0(r.spend) : el('span', { title: 'No platform spend tracked for this channel — vendor invoices live in QuickBooks', style: { color: 'var(--text-subtle)' } }, '—')),
              el('td', { class: 'px-2 py-2.5 text-right tabular-nums' }, r.leads ? r.leads.toLocaleString() : '—'),
              el('td', { class: 'px-2 py-2.5 text-right tabular-nums' }, r.accounts.toLocaleString()),
              el('td', { class: 'px-2 py-2.5 text-right tabular-nums font-semibold' }, money0(r.revenue)),
              el('td', { class: 'px-2 py-2.5 text-right tabular-nums' }, rCpl ? money0(rCpl) : '—'),
              el('td', { class: 'px-2 py-2.5 text-right tabular-nums' }, rCpa ? money0(rCpa) : '—'),
              el('td', { class: 'px-4 py-2.5 text-right tabular-nums font-bold', style: rRoas != null ? { color: rRoas >= 3 ? '#DF643A' : rRoas >= 1.5 ? '#B45309' : '#DC2626' } : {} }, rRoas != null ? rRoas.toFixed(1) + '×' : '—'));
          }))))));

  // ── 12-week trend: spend vs marketed revenue ──
  (() => {
    if (!spendDaily) return;
    const weeks = [];
    const start = new Date(now); start.setDate(start.getDate() - start.getDay() - 7 * 11);   // 12 weeks back, Sunday
    for (let i = 0; i < 12; i++) {
      const w0 = new Date(start); w0.setDate(start.getDate() + i * 7);
      const w1 = new Date(w0); w1.setDate(w0.getDate() + 6);
      weeks.push({ w0, w1, spend: 0, revenue: 0 });
    }
    for (const [day, pair] of Object.entries(spendDaily)) {
      const d = new Date(day + 'T00:00');
      const w = weeks.find(w2 => d >= w2.w0 && d <= w2.w1);
      if (w) w.spend += (Number(pair[0]) || 0) + (Number(pair[1]) || 0);
    }
    for (const s of (state._indicatorRawSales || [])) {
      if (!frPendingServiced(s)) continue;
      const src = String(s.source || '').trim();
      if (!src || /^door to door$/i.test(src)) continue;
      const d = _parseIndicatorDay(s);
      if (!d) continue;
      const w = weeks.find(w2 => d >= w2.w0 && d <= w2.w1);
      if (w) w.revenue += Number(s.contractValue) || 0;
    }
    const maxV = Math.max(1, ...weeks.map(w => Math.max(w.spend, w.revenue)));
    wrap.append(el('div', { class: 'card p-4' },
      el('div', { class: 'flex items-center justify-between mb-3' },
        el('h3', { class: 'text-sm font-bold' }, 'Spend vs Marketed Revenue · Last 12 Weeks'),
        el('div', { class: 'flex items-center gap-3 text-[10px]', style: { color: 'var(--text-muted)' } },
          el('span', {}, el('span', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '0', background: '#94A3B8', marginRight: '4px' } }), 'Spend'),
          el('span', {}, el('span', { style: { display: 'inline-block', width: '8px', height: '8px', borderRadius: '0', background: 'var(--accent)', marginRight: '4px' } }), 'Revenue'))),
      el('div', { class: 'flex items-end gap-2', style: { height: '110px' } },
        ...weeks.map(w => {
          const cell = el('div', { class: 'flex-1 flex items-end justify-center gap-0.5 cursor-help', style: { height: '100%' } },
            el('div', { style: { width: '38%', height: Math.max(2, Math.round(w.spend / maxV * 105)) + 'px', background: '#94A3B8', borderRadius: '0' } }),
            el('div', { style: { width: '38%', height: Math.max(2, Math.round(w.revenue / maxV * 105)) + 'px', background: 'var(--accent)', borderRadius: '0' } }));
          attachTooltip(cell, {
            title: 'Week of ' + w.w0.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            desc: 'Spend ' + money0(w.spend) + ' · Revenue ' + money0(w.revenue) + (w.spend > 0 ? ' · ' + (w.revenue / w.spend).toFixed(1) + '× ROAS' : ''),
          });
          return cell;
        }))));
  })();

  // ── Signals — the "walk in Monday and know" card ──
  (() => {
    const sigs = [];
    if (spendDaily) {
      const day7 = (off) => { let t = 0; for (let i = 0; i < 7; i++) { const d = new Date(now); d.setDate(d.getDate() - i - off); const pair = spendDaily[ymdOf(d)]; if (pair) t += (Number(pair[0]) || 0) + (Number(pair[1]) || 0); } return t; };
      const s7 = day7(0), sPrev = day7(7);
      if (sPrev > 0 && Math.abs(s7 / sPrev - 1) >= 0.2) sigs.push({ c: s7 > sPrev ? '#B45309' : '#2563EB', t: 'Ad spend ' + (s7 > sPrev ? 'up' : 'down') + ' ' + Math.round(Math.abs(s7 / sPrev - 1) * 100) + '% week-over-week (' + money0(s7) + ' vs ' + money0(sPrev) + ')' });
    }
    channelRows.filter(r => r.paid && r.spend > 500).forEach(r => {
      const rr = r.revenue / r.spend;
      if (rr < 1.5) sigs.push({ c: '#DC2626', t: r.label + ' ROAS is ' + rr.toFixed(1) + '× this period (' + money0(r.spend) + ' spend → ' + money0(r.revenue) + ') — review campaigns or attribution' });
      else if (rr >= 4) sigs.push({ c: '#DF643A', t: r.label + ' returning ' + rr.toFixed(1) + '× (' + money0(r.spend) + ' → ' + money0(r.revenue) + ') — room to scale budget' });
    });
    const vendorRev = channelRows.filter(r => !r.paid).reduce((a, r) => a + r.revenue, 0);
    if (vendorRev > 0 && qboSpend === 0 && !qboSlot.data) sigs.push({ c: '#B45309', t: money0(vendorRev) + ' of revenue comes from vendor channels (Angi, Yelp, eLocal…) with no spend tracked — finish the QuickBooks hookup to see their true CPA' });
    if (qboSpend > 0 && adSpend > 0 && qboSpend > adSpend * 1.15) sigs.push({ c: '#B45309', t: 'Books show ' + money0(qboSpend) + ' marketing expense vs ' + money0(adSpend) + ' platform ad spend — ' + money0(qboSpend - adSpend) + ' in agency/vendor costs beyond the platforms' });
    if (!sigs.length) sigs.push({ c: 'var(--text-muted)', t: 'No anomalies this period — spend and returns are steady.' });
    wrap.append(el('div', { class: 'card p-4' },
      el('h3', { class: 'text-sm font-bold mb-2' }, '🚨 Signals'),
      el('div', { class: 'flex flex-col gap-1.5' },
        ...sigs.map(sg => el('div', { class: 'text-xs flex items-start gap-2' },
          el('span', { style: { color: sg.c, fontWeight: '900' } }, '●'),
          el('span', { style: { color: 'var(--text)' } }, sg.t))))));
  })();

  // ── QuickBooks reconciliation ──
  wrap.append(el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between flex-wrap gap-2' },
      el('h3', { class: 'text-sm font-bold' }, '📒 Books vs Platforms'),
      el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, 'QuickBooks “Advertising & Marketing” vs Windsor platform spend')),
    qboSlot.data
      ? el('div', {},
          el('div', { class: 'grid grid-cols-1 sm:grid-cols-3 gap-3 mt-3' },
            kpi('Books (QBO)', money0(qboSpend), 'this period'),
            kpi('Platforms (Windsor)', money0(adSpend), 'Meta + Google'),
            kpi('Gap', money0(qboSpend - adSpend), 'agency fees, vendors, LSA & everything else', Math.abs(qboSpend - adSpend) > adSpend * 0.15 ? '#B45309' : null)),
          // Per-account breakdown — where the money actually sits in the
          // books (branch allocations vs Executive Marketing show up HERE).
          (() => {
            const byAcct = {};
            if (qboMonths) for (const [ym, entries] of Object.entries(qboMonths)) {
              if (!/^\d{4}-\d{2}$/.test(ym)) continue;
              const mEnd = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0);
              const mStart = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1);
              if (mEnd < p0 || mStart > p1) continue;
              for (const [name, v] of Object.entries(entries)) byAcct[name] = (byAcct[name] || 0) + (Number(v) || 0);
            }
            const rows2 = Object.entries(byAcct).sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
            if (!rows2.length) return el('p', { class: 'text-[11px] mt-3', style: { color: 'var(--text-muted)' } },
              'No marketing expense booked in this period yet — journal entries land in the month they\'re DATED, so a reallocation dated last month shows under Last Month.');
            const maxV = Math.max(1, ...rows2.map(([, v]) => Math.abs(v)));
            return el('div', { class: 'mt-4 flex flex-col gap-1.5' },
              el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'By account · ' + rows2.length),
              ...rows2.slice(0, 14).map(([name, v]) => el('div', { class: 'flex items-center gap-3 text-xs' },
                el('span', { class: 'truncate', style: { width: '190px', flex: '0 0 auto' } , title: name }, name),
                el('div', { class: 'flex-1 rounded', style: { background: 'var(--border)', height: '8px', overflow: 'hidden' } },
                  el('div', { style: { width: (Math.abs(v) / maxV * 100).toFixed(1) + '%', height: '100%', background: 'var(--accent)' } })),
                el('span', { class: 'tabular-nums font-semibold text-right', style: { width: '86px', flex: '0 0 auto' } }, money0(v)))),
              rows2.length > 14 ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, '+ ' + (rows2.length - 14) + ' more accounts') : null,
              el('div', { class: 'text-[10px] mt-1', style: { color: 'var(--text-subtle)' } },
                'Entries appear in the month they\'re dated — a June-dated reallocation lives under Last Month.'));
          })())
      : el('p', { class: 'text-xs mt-2', style: { color: 'var(--text-muted)' } },
          qboSlot.err
            ? 'QuickBooks isn\'t connected yet. One-time setup: create an Intuit app, run the OAuth flow, drop the four QBO_* env vars into Netlify (the walkthrough is at the top of netlify/functions/qbo-spend.js). Then this card reconciles your booked marketing expense against platform-reported spend — that gap is your agency fees and vendor invoices.'
            : 'Waiting on QuickBooks feed…')));

  return wrap;
}

// ── Training tab ──────────────────────────────────────────────────────────
// Houses internal onboarding / product training, recreated in-app from the
// team's Tiled content. Content lives in TRAINING_MODULES so it can be filled
// in incrementally; empty shows a placeholder. Each module has a title,
// optional description, and a body() that returns the page content.
// In-house replacement for Tiled. Each Tiled page is a full-screen image, so a
// module is just an ordered list of screen images we render natively (no Tiled
// dependency once the assets are rehosted in our own storage).
//   • screens: [{ label, image }]  → rendered natively in the in-app viewer
//   • tiled:   '<microappId>'      → temporary link out to Tiled (not yet ported)
// TRAINING_ASSET_BASE lets us point every relative screen image at our own
// Supabase Storage bucket once the originals are exported + uploaded; absolute
// URLs (http…) are used as-is.
const TRAINING_TILED_BASE = 'https://app.tiled.co/library/62291a25d862f34e4be07366/microapps/';
// Assets live in the Supabase Storage "training" bucket (public). Relative
// paths below are resolved against this base; only the filename is stored.
const TRAINING_ASSET_BASE = 'https://iqlrndyuiolbxhhwmsqv.supabase.co/storage/v1/object/public/training/';
const TRAINING_MODULES = [
  { title: 'Sales Manual', description: 'The full sales manual — 94 pages.', pdf: 'sales-mannual.pdf' },
  { title: 'Objections Manual', description: 'Handling objections — 68 pages.', pdf: 'objections-manual.pdf' },
  { title: 'FAQ', description: 'Frequently asked questions.', screens: [
    { label: 'FAQ Home', image: 'https://dznhhhcrzizxr.cloudfront.net/840755c6-29c3-435e-ad37-a6511c44b827.png' },
  ] },
  { title: 'Onboarding Meeting',          description: 'New-hire onboarding deck.',  tiled: '62f162ebcb84fb4af73465d2' },
  { title: 'Training',                    description: 'Per-rep training pages.',     tiled: '640fbf25571cf8f1edc2445b' },
];
function _trainingImg(src) { return (/^https?:/.test(src) ? src : (TRAINING_ASSET_BASE + src)); }

