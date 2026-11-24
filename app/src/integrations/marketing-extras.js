// ┌─ integrations/marketing-extras.js ─────────────────────────────────────────
// │ Marketing visuals added in the Nov 24 2026 sweep (per Isaac):
// │   mkxFunnelCard    leads → new sales → serviced → active today, per channel
// │   mkxHeatCard      calls / forms by weekday × hour (staffing view)
// │   mkxPaybackCard   months until a channel's customers pay back their CAC
// │   mkxOpenBrief     the morning brief (button on Marketing)
// │ Every number comes from what the page already computes: mklMonth() cells
// │ (leads, new sales, serviced, spend), the lead rows behind Traffic by hour,
// │ the LTV cohort model (marketing-ltv.js) and the Reporting filters. Nothing
// │ here is a new definition.
// └──────────────────────────────────────────────────────────────────────────
const _mkxMuted = { color: 'var(--text-muted)' };
function _mkxShown(k) {
  return !/^(Unspecified|Unmapped GHL source|No branch)$/.test(k)
    && (typeof mktgChannelShown !== 'function' || mktgChannelShown(k))
    && !(typeof mktgChannelHidden === 'function' && mktgChannelHidden(k));
}

// ── Funnel by channel ────────────────────────────────────────────────────────
// Leads (GoHighLevel, one per person per 30 days) → New sales (initial pending or serviced) → Serviced (initial
// completed) → Active today (serviced and not cancelled). Sales are counted by sold date in the period, leads by lead
// date, so a lead and its sale can sit in different months — the same caveat as the channel table.
function mkxFunnelCard(D, lbl) {
  if (!D || !D.ch) return null;
  const sales = D.sales || [];
  // Serviced is counted off the sale rows (initial completed) — the month cell's own `svc` is the leaderboard rule
  // (initial pending OR serviced), which is the New sales column.
  const act = new Map(), done = new Map();
  for (const r of sales) {
    if (!(!!r.initial_serviced_date || /^completed$/i.test(String(r.initial_status || '').trim()))) continue;
    const ch = typeof _mklSaleChannel === 'function' ? _mklSaleChannel(r) : '';
    done.set(ch, (done.get(ch) || 0) + 1);
    if (r.subscription_date_canceled || !/active/i.test(String(r.subscription_status || ''))) continue;
    act.set(ch, (act.get(ch) || 0) + 1);
  }
  const keys = Object.keys(D.ch).filter(k => _mkxShown(k) && ((D.ch[k].leads || 0) || (D.ch[k].s || 0))).sort((a, b) => (D.ch[b].leads || 0) - (D.ch[a].leads || 0) || (D.ch[b].s || 0) - (D.ch[a].s || 0));
  if (!keys.length) return null;
  const rowOf = (k) => ({ k, leads: D.ch[k].leads || 0, s: D.ch[k].s || 0, svc: done.get(k) || 0, act: act.get(k) || 0 });
  const rows = keys.map(rowOf);
  const tot = rows.reduce((t, r) => ({ k: 'All channels', leads: t.leads + r.leads, s: t.s + r.s, svc: t.svc + r.svc, act: t.act + r.act }), { k: 'All channels', leads: 0, s: 0, svc: 0, act: 0 });
  const COL = ['#2F5D62', '#DF643A', '#5F6C5B', '#15803D'];
  const STEPS = [['leads', 'Leads'], ['s', 'New sales'], ['svc', 'Serviced'], ['act', 'Active today']];
  const pct = (a, b) => b > 0 ? (a / b * 100).toFixed(a / b < 0.1 ? 1 : 0) + '%' : '—';
  const line = (r, strong) => {
    const base = Math.max(r.leads, r.s, 1);
    return el('tr', { class: 'border-t', style: strong ? { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } : { borderColor: 'var(--border)' } },
      el('td', { class: 'px-3 py-2 whitespace-nowrap ' + (strong ? 'font-black' : 'font-semibold') }, r.k),
      ...STEPS.map(([f, name], i) => {
        const v = r[f], prev = i ? r[STEPS[i - 1][0]] : null;
        return el('td', { class: 'px-3 py-2', style: { minWidth: '120px' }, title: name + ': ' + fmt.int(v) + (i ? ' · ' + pct(v, prev) + ' of ' + STEPS[i - 1][1].toLowerCase() : '') },
          el('div', { class: 'flex items-baseline gap-2' },
            el('span', { class: 'tabular-nums text-[12px] ' + (strong ? 'font-black' : 'font-semibold') }, fmt.int(v)),
            i ? el('span', { class: 'tabular-nums text-[10px]', style: _mkxMuted }, pct(v, prev)) : null),
          el('div', { style: { height: '6px', borderRadius: '999px', background: 'var(--card-2)', marginTop: '3px', overflow: 'hidden', border: strong ? '1px solid var(--border)' : '0' } },
            el('div', { style: { width: Math.min(100, v / base * 100) + '%', minWidth: v ? '2px' : '0', height: '100%', background: COL[i], borderRadius: '999px' } })));
      }),
      el('td', { class: 'px-3 py-2 tabular-nums text-[12px] font-bold whitespace-nowrap', title: 'Leads that became a new sale' }, pct(r.s, r.leads)));
  };
  const th = (t, tip) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap text-left', title: tip || '', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  return el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-funnel' },
    el('div', { class: 'px-5 py-3' }, el('h3', { class: 'text-base font-bold' }, 'Funnel by channel · ' + lbl)),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Channel'), th('Leads', 'GoHighLevel leads in the period'), th('New sales', 'Sold in the period — initial pending or serviced'), th('Serviced', 'Of those, initial completed'), th('Active today', 'Serviced and not cancelled'), th('Lead → sale', 'New sales ÷ leads'))),
      el('tbody', {}, ...rows.map(r => line(r, false)), line(tot, true)))));
}

// ── Calls / forms by weekday × hour ──────────────────────────────────────────
// Same leads and the same Calls / Forms switch as Traffic by hour (state._mkdHourKind), in each office's local time.
function mkxHeatCard(D, lbl) {
  if (!D || typeof _mkdLeadsOf !== 'function' || typeof _mkdLocalHour !== 'function') return null;
  const kind = state._mkdHourKind === 'form' ? 'form' : 'call';
  const want = kind === 'call' ? ['call', 'ai'] : ['form'];
  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  const grid = DAYS.map(() => new Array(24).fill(0)); let n = 0;
  const fmtCache = new Map();
  const dowOf = (l) => {
    const tz = (typeof MKD_OFFICE_TZ !== 'undefined' && MKD_OFFICE_TZ[String(l.market || '').toUpperCase()]) || 'America/New_York';
    let f = fmtCache.get(tz); if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short' }); fmtCache.set(tz, f); }
    const dt = new Date((l.dUtc || l.d) + 'T' + l.t + ':00Z'); if (isNaN(dt)) return -1;
    return DAYS.indexOf(f.format(dt));
  };
  for (const l of _mkdLeadsOf(D, null, null)) {
    if (!want.includes(l.type) || !l.t) continue;
    const h = _mkdLocalHour(l); if (h == null) continue;
    const d = dowOf(l); if (d < 0) continue;
    grid[d][h]++; n++;
  }
  if (!n) return null;
  const max = Math.max(1, ...grid.map(r => Math.max(...r)));
  const lab = (h) => h === 0 ? '12a' : h < 12 ? h + 'a' : h === 12 ? '12p' : (h - 12) + 'p';
  const rgb = kind === 'call' ? '223,100,58' : '95,108,91';
  const dayTot = grid.map(r => r.reduce((a, v) => a + v, 0));
  let peak = { v: 0, d: 0, h: 0 }; grid.forEach((r, d) => r.forEach((v, h) => { if (v > peak.v) peak = { v, d, h }; }));
  const cell = (v, d, h) => el('div', { title: DAYS[d] + ' ' + lab(h) + '–' + lab((h + 1) % 24) + ' · ' + fmt.int(v) + (kind === 'call' ? ' call' : ' form') + (v === 1 ? '' : 's'),
    style: { height: '20px', borderRadius: '4px', background: v ? 'rgba(' + rgb + ',' + (0.12 + 0.88 * v / max).toFixed(2) + ')' : 'var(--card-2)', color: v / max > 0.55 ? '#fff' : 'var(--text-muted)', fontSize: '9px', lineHeight: '20px', textAlign: 'center', fontVariantNumeric: 'tabular-nums' } }, v && v / max >= 0.35 ? String(v) : '');
  const cols = '34px repeat(24, minmax(16px, 1fr)) 40px';
  return el('div', { class: 'card p-4', 'data-arrange-id': 'mkt-heat' },
    el('div', { class: 'flex items-baseline gap-3 flex-wrap mb-3' },
      el('h3', { class: 'text-base font-bold' }, (kind === 'call' ? 'Calls' : 'Forms') + ' by day and hour · ' + lbl),
      el('span', { class: 'text-[11px]', style: _mkxMuted }, 'Busiest: ' + DAYS[peak.d] + ' ' + lab(peak.h) + ' (' + fmt.int(peak.v) + ') · local time · follows the Calls / Forms switch above')),
    el('div', { class: 'scroll-x' }, el('div', { style: { minWidth: '560px', display: 'grid', gridTemplateColumns: cols, gap: '2px', alignItems: 'center' } },
      el('div', {}), ...Array.from({ length: 24 }, (_, h) => el('div', { class: 'text-center text-[9px] tabular-nums', style: { color: h % 3 === 0 ? 'var(--text-muted)' : 'transparent' } }, lab(h))), el('div', { class: 'text-right text-[9px] uppercase', style: _mkxMuted }, 'Total'),
      ...grid.flatMap((r, d) => [el('div', { class: 'text-[10px] font-semibold', style: _mkxMuted }, DAYS[d]), ...r.map((v, h) => cell(v, d, h)), el('div', { class: 'text-right text-[10px] font-bold tabular-nums' }, fmt.int(dayTot[d]))]))));
}

// ── Channel payback ──────────────────────────────────────────────────────────
// CAC = the channel's marketing spend ÷ its new sales (the Marketing CAC rule), year to date through the selected month. Payback =
// the first month where what one of that channel's customers has paid (the LTV cohort curve for that FieldRoutes
// source; gross margin applied when one is set) reaches the CAC. A channel with too few customers of its own rides
// the company curve scaled to its early months — the LTV model's rule, unchanged. Spend-only: wages are not in.
function mkxPaybackCard(ym) {
  if (typeof mklMonth !== 'function' || typeof ltvModel !== 'function') return null;
  const year = Number(String(ym).slice(0, 4)), last = Number(String(ym).slice(5, 7));
  if (!(year > 2000) || !(last >= 1)) return null;
  const head = el('div', { class: 'px-5 py-3 flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Channel payback · ' + year + ' to date'));
  if (!state._ltv) return el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-payback' }, head,
    el('div', { class: 'px-5 pb-4 text-sm', style: _mkxMuted }, state._ltvMissing ? 'Needs the LTV cohort file, which has not been published yet (it is built nightly by the ltv-cohorts server job).' : 'Loading the LTV cohorts…'));
  const agg = {};
  for (let i = 1; i <= last; i++) {
    const M = mklMonth(year + '-' + String(i).padStart(2, '0')); if (!M || !M.ch || !M.hasSpend) continue;
    for (const k in M.ch) { if (!_mkxShown(k)) continue; const c = M.ch[k], t = agg[k] || (agg[k] = { spend: 0, svc: 0 }); t.spend += c.spend || 0; t.svc += c.svc || 0; }
  }
  const margin = typeof ltvMargin === 'function' ? ltvMargin() : null;
  const rows = Object.keys(agg).filter(k => agg[k].spend > 0 && agg[k].svc > 0).map(k => {
    const cac = agg[k].spend / agg[k].svc;
    const own = ltvModel('source:' + k, { horizon: 36, margin });
    const M = own || ltvModel('seller:office', { horizon: 36, margin });
    return { k, cac, svc: agg[k].svc, spend: agg[k].spend, pb: M ? M.payback(cac) : null, ltv: M ? M.ltv : null, own: !!own, n: own ? own.nAll : 0, seen: M ? M.observedTo : 0 };
  }).sort((a, b) => (a.pb == null ? 999 : a.pb) - (b.pb == null ? 999 : b.pb) || a.cac - b.cac);
  if (!rows.length) return el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-payback' }, head, el('div', { class: 'px-5 pb-4 text-sm', style: _mkxMuted }, 'No channel has both spend and new sales for ' + year + ' yet.'));
  const th = (t, tip) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap text-left', title: tip || '', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const col = (m) => m == null ? '#B91C1C' : m <= 6 ? '#15803D' : m <= 12 ? '#65A30D' : m <= 18 ? '#D97706' : '#B91C1C';
  return el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-payback' },
    el('div', { class: 'px-5 py-3 flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Channel payback · ' + year + ' to date'),
      el('span', { class: 'text-[11px]', style: _mkxMuted }, 'Months until a customer has paid back what it cost to get them' + (margin ? ' · at ' + Math.round(margin) + '% gross margin' : ' · on revenue (no margin set)') + ' · marketing spend only')),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Channel'), th('Payback', 'First month where cumulative ' + (margin ? 'margin' : 'revenue') + ' per customer reaches the CAC'), th('CAC', 'Marketing spend ÷ new sales (initial pending or serviced), year to date — the Marketing CAC tile\u2019s rule'), th('36-mo LTV', 'What one customer pays over 36 months' + (margin ? ', at margin' : '')), th('LTV ÷ CAC'), th('New sales'), th('Curve', 'Whose retention / revenue curve the payback uses'))),
      el('tbody', {}, ...rows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, r.k),
        el('td', { class: 'px-3 py-2', style: { minWidth: '200px' } }, el('div', { class: 'flex items-center gap-2' },
          el('div', { style: { flex: '1 1 auto', height: '8px', borderRadius: '999px', background: 'var(--card-2)', overflow: 'hidden' } },
            el('div', { style: { width: (r.pb == null ? 100 : Math.min(100, r.pb / 36 * 100)) + '%', height: '100%', background: col(r.pb), borderRadius: '999px', opacity: r.pb == null ? '.35' : '1' } })),
          el('span', { class: 'tabular-nums font-black text-[12px] whitespace-nowrap', style: { color: col(r.pb), minWidth: '64px' } }, r.pb == null ? '36+ mo' : r.pb + ' mo'))),
        el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap' }, fmt.usd0(r.cac)),
        el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap' }, r.ltv ? fmt.usd0(r.ltv) : '—'),
        el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap font-bold' }, r.ltv ? (r.ltv / r.cac).toFixed(1) + 'x' : '—'),
        el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap' }, fmt.int(r.svc)),
        el('td', { class: 'px-3 py-2 text-[11px] whitespace-nowrap', style: _mkxMuted }, r.own ? 'Its own customers (' + fmt.int(r.n) + ')' + (r.seen < 36 ? ' · company curve after month ' + r.seen : '') : 'Office Staff average (no cohort for this source)')))))));
}

// ── Morning brief ────────────────────────────────────────────────────────────
// Yesterday at a glance + anything that needs fixing. Opens from the button on Marketing; nothing is sent anywhere.
function mkxBriefData() {
  const now = new Date(), y = new Date(now); y.setDate(y.getDate() - 1);
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const day = iso(y);
  const subs = (typeof reportingFilters === 'function' ? (reportingFilters().visible || []) : (state.reportingSubscriptions || []));
  const F = typeof reportingFilters === 'function' ? reportingFilters() : {};
  const isRen = (r) => typeof reportingSourceClass === 'function' && reportingSourceClass(reportingSourceOf(r)) === 'renewal';
  const top = (m, n) => [...m].sort((a, b) => b[1] - a[1]).slice(0, n);
  const bump = (m, k, v) => m.set(k, (m.get(k) || 0) + (v == null ? 1 : v));
  const sold = { n: 0, cv: 0, by: new Map(), office: new Map() }, svc = { n: 0, arr: 0 }, cxl = { n: 0, arr: 0, office: new Map() };
  for (const r of subs) {
    if (String(r.sold_date || '').slice(0, 10) === day && !isRen(r)) { sold.n++; sold.cv += Number(r.subscription_contract_value) || 0; bump(sold.by, String(r.sold_by_type || 'Other')); bump(sold.office, String(r.office_name || '—')); }
    if (String(r.initial_serviced_date || '').slice(0, 10) === day && !isRen(r)) { svc.n++; svc.arr += Number(r.annual_recurring_value) || 0; }
    if (String(r.subscription_date_canceled || '').slice(0, 10) === day && (!F.isRealCancel || F.isRealCancel(r))) { cxl.n++; cxl.arr += Number(r.annual_recurring_value) || 0; bump(cxl.office, String(r.office_name || '—')); }
  }
  const AL = typeof mkpAllLeads === 'function' ? mkpAllLeads() : null;
  const leads = { n: 0, by: new Map(), ok: !!AL };
  if (AL) for (const l of AL.leads) { if (l.d !== day) continue; if (!_mkxShown(l.prov)) continue; leads.n++; bump(leads.by, l.prov); }
  // Needs a look
  const issues = [];
  try {
    const m = new Map();
    for (const s of (state.allSales || [])) { if (s.rep_id || (s.queue_type || 'office') !== 'office' || !['serviced', 'below_minimums'].includes(s.audit_status) || s.payroll_processed_at) continue; const raw = String(s.crm_seller_name || '').trim(); bump(m, raw.includes(',') ? raw.split(',').map(t => t.trim()).reverse().join(' ') : (raw || 'No seller in FieldRoutes')); }
    if (m.size) issues.push('Payable sales under sellers with no app account: ' + top(m, 6).map(([n, c]) => n + ' (' + c + ')').join(', '));
  } catch (e) { /* skip */ }
  try {
    const G = state._ghl;
    if (G && G.opps && G.labels) {
      const since = iso(new Date(now.getFullYear(), now.getMonth(), 1)); const un = new Map();
      for (const o of G.opps) { if (!o || o[0] < since || o[1] == null || o[1] < 0) continue; const lab = G.labels[o[1]]; if (!lab) continue; if (typeof MKP_NOT_A_SOURCE !== 'undefined' && MKP_NOT_A_SOURCE.test(String(lab))) continue; const p = typeof ghlProviderOf === 'function' ? ghlProviderOf(lab) : lab; const set = typeof mkmChannelSet === 'function' ? mkmChannelSet() : null; if (p && p !== GHL_NOT_LEAD && set && !set.has(p)) bump(un, lab); }
      if (un.size) issues.push('GoHighLevel sources with no channel this month: ' + top(un, 5).map(([n, c]) => n + ' (' + c + ')').join(', '));
      if (G.at && Date.now() - Date.parse(G.at) > 3 * 3600000) issues.push('GoHighLevel leads last synced ' + new Date(G.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' — more than 3 hours ago');
    } else issues.push('GoHighLevel leads are not loaded');
  } catch (e) { /* skip */ }
  const asOf = typeof crmDataAsOfStr === 'function' ? crmDataAsOfStr(false) : '';
  return { day, dayLabel: y.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }), sold, svc, cxl, leads, issues, asOf, top };
}
function mkxOpenBrief() {
  const B = mkxBriefData();
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey); overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const list = (m, n) => B.top(m, n).map(([k, c]) => k + ' ' + c).join(' · ');
  const net = B.svc.arr - B.cxl.arr;
  const lines = [
    ['New sales', fmt.int(B.sold.n) + ' · ' + fmt.usd0(B.sold.cv) + ' contracted', list(B.sold.by, 4) + (B.sold.office.size ? '  |  ' + list(B.sold.office, 3) : '')],
    ['Serviced (new ARR)', fmt.int(B.svc.n) + ' · ' + fmt.usd0(B.svc.arr), ''],
    ['Churned', fmt.int(B.cxl.n) + ' · ' + fmt.usd0(B.cxl.arr) + ' ARR', list(B.cxl.office, 3)],
    ['Net book change', (net < 0 ? '−' : '+') + fmt.usd0(Math.abs(net)), 'serviced − churned'],
    ['Leads', B.leads.ok ? fmt.int(B.leads.n) : 'not loaded', B.leads.ok ? list(B.leads.by, 5) : ''],
  ];
  const text = 'RIDD morning brief — ' + B.dayLabel + '\n' + lines.map(([a, b, c]) => a + ': ' + b + (c ? ' (' + c + ')' : '')).join('\n')
    + '\n' + (B.issues.length ? 'Needs a look:\n' + B.issues.map(x => '• ' + x).join('\n') : 'Nothing flagged.') + (B.asOf ? '\nData as of ' + B.asOf : '');
  const tile = ([a, b, c], i) => el('div', { style: { borderRadius: '10px', padding: '10px 12px', background: 'var(--card-2)' } },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, a),
    el('div', { class: 'text-lg font-black tabular-nums', style: { color: i === 3 ? (net < 0 ? '#DC2626' : '#15803D') : i === 2 ? '#DC2626' : 'var(--text)' } }, b),
    c ? el('div', { class: 'text-[11px]', style: _mkxMuted }, c) : null);
  overlay.append(el('div', { class: 'card', style: { width: 'min(640px, 96vw)', maxHeight: '86vh', overflow: 'auto', margin: '8vh auto 0' }, onclick: (e) => e.stopPropagation() },
    el('div', { class: 'flex items-center gap-3 px-5 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'flex-1' }, el('h3', { class: 'text-base font-bold' }, 'Morning brief'), el('div', { class: 'text-[11px]', style: _mkxMuted }, 'Yesterday · ' + B.dayLabel + (B.asOf ? ' · data as of ' + B.asOf : ''))),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)' }, onclick: (e) => { try { navigator.clipboard.writeText(text); e.currentTarget.textContent = 'Copied'; } catch (err) { /* clipboard blocked */ } } }, 'Copy as text'),
      el('button', { class: 'text-2xl leading-none px-1', style: _mkxMuted, 'aria-label': 'Close', onclick: close }, '×')),
    el('div', { class: 'p-4 grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' } }, ...lines.map(tile)),
    el('div', { class: 'px-5 pb-4' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, 'Needs a look'),
      B.issues.length ? el('ul', { class: 'text-[12px] flex flex-col gap-1' }, ...B.issues.map(x => el('li', { style: { color: '#B45309' } }, '• ' + x))) : el('div', { class: 'text-[12px]', style: { color: '#15803D' } }, 'Nothing flagged.'))));
  document.body.append(overlay);
}
