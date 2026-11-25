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

// ── Provider pulse ───────────────────────────────────────────────────────────
// "Should this provider get more budget?" at a glance (per Isaac, Nov 25: a provider runs out of budget before the
// month ends and emails for more). One row per lead provider: the monthly budget (typed in by the owner, saved for
// everyone in adminRules.provBudgets), what QuickBooks has booked against it so far and when it runs out at this
// pace, then what the money bought — leads, new sales, CAC, return — next to the provider's own last three closed
// months. Every number is the Marketing tab's own cell (mklMonth). The Suggestion column is a rule, written out in
// its tooltip, never a judgement call: it only speaks once there are 5 new sales or 30 leads to read.
//   Raise  = CAC at or under the month's all-provider CAC AND no more than 15% over its own 3-month CAC
//   Cut    = CAC at least 1.5x the all-provider CAC, or spend past two all-provider CACs with no sale
//   Hold   = anything else
// "Confirmed" = the share of the provider's new sales with a Pest AI lead behind them — the trust level of the row.
// Nov 25 (per Isaac): this table replaces "Funnel by channel" as Channel metrics — one row per source with the spend
// QuickBooks has for it, leads, bookings (new sales), serviced and the FieldRoutes revenue. On a range (YTD / full
// year) the budget and 3-month comparisons are left out: a budget is monthly.
function mkxProviderPulseCard(ym, DR, rangeLbl) {
  if (typeof mklMonth !== 'function') return null;
  const isRange = !!DR;
  const D = DR || mklMonth(ym); if (!D || !D.ch) return null;
  const R = (typeof _adminRules === 'function' && _adminRules()) || {}, B = (R.provBudgets && typeof R.provBudgets === 'object') ? R.provBudgets : {};
  const owner = typeof isOwnerUser === 'function' && isOwnerUser();
  const today = new Date(), isOpen = !isRange && ym === _mklYm(today), dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate(), day = isOpen ? today.getDate() : dim;
  const prior = isRange ? [] : [1, 2, 3].map(n => mklMonth(_mklShift(ym, -n))).filter(Boolean);
  const keys = [...new Set([...Object.keys(D.ch), ...(isRange ? [] : Object.keys(B))])].filter(k => _mkxShown(k) && ((D.ch[k] && (D.ch[k].spend || D.ch[k].leads || D.ch[k].s)) || Number(B[k]) > 0));
  if (!keys.length) return null;
  const tot = keys.reduce((t, k) => { const c = D.ch[k] || {}; t.spend += c.spend || 0; t.s += c.s || 0; return t; }, { spend: 0, s: 0 });
  const allCac = tot.s > 0 && tot.spend > 0 ? tot.spend / tot.s : null;
  const salesOf = (k) => { if (D.ch[k] && Array.isArray(D.ch[k].sales)) return D.ch[k].sales; const out = []; for (const o in (D.x || {})) { const c = D.x[o][k]; if (c && c.sales) for (const s of c.sales) out.push(s); } return out; };
  const rows = keys.map(k => {
    const c = D.ch[k] || { spend: 0, leads: 0, s: 0, cv: 0 };
    const p = prior.reduce((t, M) => { const x = (M.ch || {})[k]; if (x) { t.spend += x.spend || 0; t.leads += x.leads || 0; t.s += x.s || 0; t.cv += x.cv || 0; } return t; }, { spend: 0, leads: 0, s: 0, cv: 0 });
    const budget = isRange ? null : (typeof mkbBudgetOf === 'function' ? mkbBudgetOf(ym, k) : (Number(B[k]) > 0 ? Number(B[k]) : null));
    const cac = c.s > 0 && c.spend > 0 ? c.spend / c.s : null, cac3 = p.s > 0 && p.spend > 0 ? p.spend / p.s : null;
    const perDay = day > 0 ? c.spend / day : 0, runOut = budget && perDay > 0 ? Math.ceil(budget / perDay) : null;
    const sales = salesOf(k), linked = sales.filter(s => s._mklLead).length;
    const svcN = sales.filter(s => !!s.initial_serviced_date || String(s.initial_status || '').trim().toLowerCase() === 'completed').length;
    // The read (per Isaac, Nov 25): what the money spent so far SHOULD have bought, on the provider's own last three closed
    // months (mkbBaseline — the same record the budget's expectation uses), against what it has bought.
    const base = !isRange && typeof mkbBaseline === 'function' ? mkbBaseline(ym, k) : null;
    const expS = budget && base && base.cac ? budget / base.cac : null;
    const dueS = base && base.cac && c.spend ? c.spend / base.cac : null;
    const ratio = dueS && dueS >= 3 ? c.s / dueS : null;
    let verdict = null, why = '';
    if (isRange) why = '';
    else if (!D.hasSpend || !c.spend) why = 'No QuickBooks spend booked for this provider this month yet.';
    else if (!base || !base.cac) why = 'No spend with bookings in its last three closed months, so there is nothing to expect yet.';
    else if (ratio == null) why = 'The spend so far should have bought under 3 bookings — too little to read.';
    else { verdict = ratio >= 1.1 ? 'raise' : ratio >= 0.9 ? 'hold' : 'cut';
      why = fmt.int(c.s) + ' bookings against ' + fmt.int(Math.round(dueS)) + ' expected for ' + fmt.usd0(c.spend) + ' spent (' + Math.round(ratio * 100) + '%).' + (verdict === 'raise' ? ' More budget is buying at better than its usual cost.' : verdict === 'cut' ? ' More budget would buy at worse than its usual cost.' : ''); }
    return { k, c, p, budget, cac, cac3, runOut, linked, nSales: sales.length, svcN, verdict, why, expS, dueS,
      cpl: c.leads > 0 && c.spend > 0 ? c.spend / c.leads : null, close: c.leads > 0 ? c.s / c.leads : null, close3: p.leads > 0 ? p.s / p.leads : null, roas: c.spend > 0 ? c.cv / c.spend : null };
  }).sort((a, b) => (b.c.spend - a.c.spend) || (b.c.leads - a.c.leads));
  const th = (t, tip) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap text-left', title: tip || '', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const td = (...kids) => el('td', { class: 'px-3 py-2 tabular-nums whitespace-nowrap align-top' }, ...kids);
  const sub = (t, color) => el('div', { class: 'text-[10px]', style: { color: color || 'var(--text-subtle)' } }, t);
  const V = { raise: ['Ahead of plan', 'rgba(21,128,61,.12)', '#15803D'], hold: ['On plan', 'rgba(47,93,98,.12)', '#2F5D62'], cut: ['Behind plan', 'rgba(220,38,38,.12)', '#DC2626'] };
  const setBudget = (k, v) => { if (typeof mkbSetBudget === 'function') { mkbSetBudget(ym, k, v); mountApp(); return; } const next = Object.assign({}, B); const n = Number(String(v).replace(/[^0-9.]/g, '')); if (n > 0) next[k] = Math.round(n); else delete next[k]; _setAdminRule('provBudgets', next); try { if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {}); } catch (e) { /* syncs on the next save */ } mountApp(); };
  const dlt = (now, was, lowGood) => now == null || was == null || !was ? null : (() => { const d = now / was - 1; if (Math.abs(d) < 0.005) return null; const good = lowGood ? d < 0 : d > 0; return sub((d > 0 ? '↑ ' : '↓ ') + Math.abs(d * 100).toFixed(0) + '% vs its 3-mo', good ? '#15803D' : '#B91C1C'); })();
  // The pacer under the read (per Isaac, Nov 24 — a bar, not a sentence or a grid: the table was too big). Two thin
  // bars on one scale: spend and revenue. Solid = so far; the lighter run = where it lands at month end at this daily
  // pace (so far ÷ days gone × days in the month); the tick on the spend bar is the budget. Numbers are on hover.
  const pacer = (r) => {
    if (isRange || (!r.c.spend && !r.c.cv)) return null;
    const proj = (v) => isOpen && day > 0 ? v / day * dim : v;
    const sp = r.c.spend || 0, rv = r.c.cv || 0, pS = proj(sp), pR = proj(rv), max = Math.max(pS, pR, r.budget || 0, 1), overB = r.budget && pS > r.budget * 1.02;
    const W = 120, w = (v) => Math.max(0, Math.min(100, v / max * 100)) + '%';
    const bar = (lab, now, end, solid, light, tick) => el('div', { class: 'flex items-center gap-1.5' },
      el('span', { class: 'text-[9px] uppercase', style: { color: 'var(--text-subtle)', width: '24px', letterSpacing: '.04em' } }, lab),
      el('div', { style: { position: 'relative', width: W + 'px', height: '5px', borderRadius: '999px', background: 'var(--card-2)', overflow: 'hidden' } },
        el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: w(end), background: light } }),
        el('div', { style: { position: 'absolute', left: 0, top: 0, bottom: 0, width: w(now), background: solid } }),
        tick != null ? el('div', { style: { position: 'absolute', top: 0, bottom: 0, left: 'calc(' + w(tick) + ' - 1px)', width: '2px', background: 'var(--text)' } }) : null));
    const tip = 'Spend ' + (sp ? fmt.usd0(sp) : '\u2014') + (isOpen && sp ? ' so far \u2192 ' + fmt.usd0(pS) + ' projected' : '') + (r.budget ? ' (budget ' + fmt.usd0(r.budget) + ')' : '')
      + ' \u00b7 Revenue ' + fmt.usd0(rv) + (isOpen ? ' so far \u2192 ' + fmt.usd0(pR) + ' projected' : '') + (r.why ? ' \u00b7 ' + r.why : '');
    return el('div', { class: 'mt-1.5 flex flex-col gap-1', title: tip },
      bar('Spnd', sp, pS, overB ? '#DC2626' : '#2F5D62', overB ? 'rgba(220,38,38,.3)' : 'rgba(47,93,98,.3)', r.budget || null),
      bar('Rev', rv, pR, '#15803D', 'rgba(21,128,61,.3)', null));
  };
  const lbl = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-provpulse' },
    el('div', { class: 'px-5 py-3 flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, 'Channel metrics · ' + (isRange ? rangeLbl : lbl + (isOpen ? ' · day ' + day + ' of ' + dim : '')))),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse', minWidth: '980px' } },
      el('thead', {}, el('tr', {}, th('Channel'), isRange ? null : th('Budget', 'Monthly budget you gave the provider — saved for everyone'), th('Spend', 'QuickBooks spend booked this month, and when the budget runs out at this daily pace'),
        th('Leads', 'GoHighLevel leads this month and cost per lead'), th('Bookings', 'New sales: initial on the calendar or serviced, by the FieldRoutes source (last touch), with the close rate'), th('Serviced', 'Bookings whose initial service is done'), th('Revenue', 'Contract value of those bookings, from FieldRoutes'), th('CAC', 'Spend ÷ bookings'), th('Return', 'Revenue ÷ spend'),
        th('Confirmed', 'New sales with a Pest AI lead behind them — how far the row can be trusted'), th('Read', 'Bookings so far ÷ the bookings the spend so far should have bought, on the provider’s own last three closed months. Ahead = 110% or more, behind = under 90%. Needs at least 3 expected bookings.'))),
      el('tbody', {}, ...rows.map(r => { const used = r.budget ? r.c.spend / r.budget : null, over = used != null && used >= 1;
        const lateRun = r.runOut != null && isOpen && r.runOut < dim;
        return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap align-top' }, r.k),
          // Budget comes from the Budget tab (per Isaac, Nov 25) — shown here, typed there.
          isRange ? null : td(r.budget ? el('div', { class: 'font-semibold' }, fmt.usd0(r.budget)) : (owner ? el('button', { class: 'text-[11px] underline', style: { color: 'var(--accent)' }, onclick: () => { state._mktSub = 'plan'; mountApp(); } }, 'set on Media plan →') : '—'),
            r.expS != null ? sub('should bring ' + fmt.int(Math.round(r.expS)) + ' bookings') : null),
          td(el('div', { class: 'font-semibold' }, r.c.spend ? fmt.usd0(r.c.spend) : '—'),
            used != null ? el('div', { style: { width: '110px', height: '6px', borderRadius: '999px', background: 'var(--card-2)', overflow: 'hidden', margin: '3px 0' } }, el('div', { style: { width: Math.min(100, used * 100) + '%', height: '100%', borderRadius: '999px', background: over ? '#DC2626' : lateRun ? '#D97706' : '#2F5D62' } })) : null,
            used != null ? sub(Math.round(used * 100) + '% of budget' + (over ? ' · over' : lateRun ? ' · runs out about day ' + r.runOut : isOpen && r.runOut ? ' · lasts the month' : ''), over ? '#DC2626' : lateRun ? '#B45309' : undefined) : null),
          td(el('div', { class: 'font-semibold' }, fmt.int(r.c.leads)), sub(r.cpl != null ? fmt.usd0(r.cpl) + ' a lead' : '')),
          td(el('div', { class: 'font-semibold' }, fmt.int(r.c.s)), sub(r.close != null ? (r.close * 100).toFixed(1) + '% close' : ''), r.dueS != null && r.dueS >= 1 ? sub('should be ' + fmt.int(Math.round(r.dueS)) + ' by now', r.c.s >= r.dueS * 0.9 ? '#15803D' : '#B91C1C') : dlt(r.close, r.close3, false)),
          td(el('div', { class: 'font-semibold' }, fmt.int(r.svcN)), sub(r.c.s ? Math.round(r.svcN / r.c.s * 100) + '% of bookings' : '')),
          td(el('div', { class: 'font-semibold' }, r.c.cv ? fmt.usd0(r.c.cv) : '—'), sub(r.c.s && r.c.cv ? fmt.usd0(r.c.cv / r.c.s) + ' each' : '')),
          td(el('div', { class: 'font-black' }, r.cac != null ? fmt.usd0(r.cac) : '—'), dlt(r.cac, r.cac3, true)),
          td(r.roas != null ? r.roas.toFixed(1) + 'x' : '—'),
          td(r.nSales ? el('span', { style: { color: r.linked / r.nSales >= 0.8 ? '#15803D' : r.linked / r.nSales >= 0.5 ? '#B45309' : '#DC2626', fontWeight: 700 } }, Math.round(r.linked / r.nSales * 100) + '%') : '—', r.nSales ? sub(r.linked + ' of ' + r.nSales + ' sales') : null),
          el('td', { class: 'px-3 py-2 align-top', title: r.why }, r.verdict ? el('span', { class: 'rounded-full px-2 py-0.5 text-[11px] font-black whitespace-nowrap', style: { background: V[r.verdict][1], color: V[r.verdict][2] } }, V[r.verdict][0]) : el('span', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } }, isRange ? '—' : 'Too little to read'),
            pacer(r))); })))));
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

// ── Office × channel (per Isaac, Nov 25): the CMO view — new revenue, spend and acquisition cost for every office by
// every channel on one table, one measure at a time. Offices across, channels down, a total row and column. Cells are
// the Marketing tab's own (mklMonth → x[office][channel]): revenue and sales from FieldRoutes by the account's office
// and last-touch source, leads from Pest AI, spend from QuickBooks as split to offices on Spend setup — so a cell's
// spend is only as exact as that channel's split rule. A cost or rate on a thin cell is noise, not a signal: CAC and
// return need 5 sales, close rate needs 10 leads; under that the cell is blank. Replaces Channels × offices.
function mkxOfficeChannelCard(ym, cur, rangeLbl) {
  if (typeof mklMonth !== 'function' || !cur) return null;
  const S = state._mkxOC || (state._mkxOC = { metric: 'cv', span: 'month' });
  const year = Number(ym.slice(0, 4)), mi = Number(ym.slice(5, 7)) - 1;
  const fixed = !!cur.range;   // the page's own picker is already on a range
  const D = fixed ? cur : S.span === 'ytd' && typeof mklRange === 'function' ? mklRange(year, mi, 0) : cur;
  if (!D || !D.ch || !D.br) return null;
  const skip = (k) => /^(Unspecified|No branch|Unmapped GHL source)$/.test(k);
  const has = (c) => c && ((c.spend || 0) || (c.leads || 0) || (c.s || 0));
  const offices = Object.keys(D.br).filter(k => !skip(k) && has(D.br[k])).sort((a, b) => (D.br[b].cv || 0) - (D.br[a].cv || 0) || a.localeCompare(b));
  const channels = Object.keys(D.ch).filter(k => !skip(k) && _mkxShown(k) && has(D.ch[k])).sort((a, b) => (D.ch[b].cv || 0) - (D.ch[a].cv || 0) || (D.ch[b].spend || 0) - (D.ch[a].spend || 0) || a.localeCompare(b));
  if (!offices.length || !channels.length) return null;
  const X = D.x || {}, zero = { spend: 0, leads: 0, s: 0, cv: 0 };
  const usd = (v) => v == null || !isFinite(v) ? null : fmt.usd0(v), int = (v) => v ? fmt.int(v) : null;
  const sp = (c) => D.hasSpend ? (c.spend || 0) : null;
  const linkedOf = (c) => c._linked != null ? c._linked : c.linked != null ? c.linked : (c.s || 0) - ((c.unlinked || []).length);
  // Totals carry the linked count summed from their cells (the month's own totals do not hold it by office or channel).
  const sumLinked = (pick) => { let t = 0; for (const o in (D.x || {})) for (const c in D.x[o]) if (pick(o, c)) t += linkedOf(D.x[o][c]); return t; };
  const withLinked = (cell, pick) => Object.assign({}, cell, { _linked: sumLinked(pick) });
  const M = {
    cv:    { t: 'New revenue', get: (c) => c.cv || null, f: usd, up: true, tip: 'Contract value of new sales (initial booked or serviced), by the account’s office and FieldRoutes source' },
    spend: { t: 'Spend', get: (c) => sp(c) || null, f: usd, up: null, tip: 'QuickBooks marketing spend, split to offices by each channel’s rule on Spend setup' },
    cac:   { t: 'CAC', get: (c) => sp(c) > 0 && (c.s || 0) >= 5 ? sp(c) / c.s : null, f: usd, up: false, tip: 'Spend ÷ new sales. Blank under 5 sales.' },
    s:     { t: 'New sales', get: (c) => c.s || null, f: int, up: true, tip: 'New sales: initial booked or serviced' },
    leads: { t: 'Leads', get: (c) => c.leads || null, f: int, up: true, tip: 'Pest AI leads, by the lead’s office' },
    // Close rate counts only sales that trace back to a lead (as the old Channels × offices grid did): a channel like
    // Organic books sales that never were a Pest AI lead, and counting every sale read as 200%+.
    close: { t: 'Close rate', get: (c) => (c.leads || 0) >= 10 ? linkedOf(c) / c.leads : null, f: (v) => v == null ? null : (v * 100).toFixed(0) + '%', up: true, tip: 'New sales that came from a lead / leads. Blank under 10 leads.' },
    ret:   { t: 'Return', get: (c) => sp(c) > 0 && (c.s || 0) >= 5 ? (c.cv || 0) / sp(c) : null, f: (v) => v == null ? null : v.toFixed(1) + 'x', up: true, tip: 'New revenue ÷ spend. Blank under 5 sales.' } };
  const m = M[S.metric] || M.cv;
  const cellOf = (o, c) => (X[o] && X[o][c]) || zero;
  const vals = channels.flatMap(c => offices.map(o => m.get(cellOf(o, c)))).filter(v => v != null && isFinite(v));
  const max = vals.length ? Math.max(...vals) : 0, all = m.get({ spend: D.spend, leads: D.leads, s: D.s, cv: D.cv, _linked: D.linked != null ? D.linked : D.s });
  // Shade: bigger = darker for the measures where more is the point; for CAC the colour says which side of the
  // company-wide figure a cell sits on (green = cheaper, red = dearer by 25% or more).
  const style = (v) => { if (v == null) return { color: 'var(--text-subtle)' };
    if (m.up === false) return all ? { color: v <= all * 0.75 ? '#15803D' : v >= all * 1.25 ? '#DC2626' : 'var(--text)', fontWeight: v <= all * 0.75 || v >= all * 1.25 ? '800' : '500' } : {};
    if (m.up === null || !max) return {};
    const r = Math.min(1, v / max); return { background: 'rgba(95,108,91,' + (0.06 + 0.6 * r).toFixed(2) + ')', color: r > 0.55 ? '#fff' : 'var(--text)' }; };
  const lbl = fixed ? (rangeLbl || 'range') : S.span === 'ytd' ? 'Jan–' + new Date(year, mi, 1).toLocaleDateString('en-US', { month: 'short' }) + ' ' + year : new Date(year, mi, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  const open = (title, o, c, base) => () => { if (typeof _mkdOpenCell === 'function' && typeof _mkdAgg === 'function') _mkdOpenCell(title, _mkdAgg(D, o, c, base), D); };
  const td = (v, title, onclick, strong, bandBg) => { const st = bandBg ? { background: bandBg } : style(v);
    return el('td', { class: 'px-2 py-1.5 text-right tabular-nums whitespace-nowrap' + (onclick && v != null ? ' cursor-pointer' : ''), title: title || '', onclick: v != null ? onclick : null,
      style: Object.assign({ borderLeft: '1px solid var(--border)', fontWeight: strong ? '800' : undefined }, st) }, m.f(v) || '—'); };
  const th = (t, right) => el('th', { class: 'px-2 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const seg = (opts, cur2, set) => el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } }, ...opts.map(([k, l, tip]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold', title: tip || '', style: cur2 === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { set(k); mountApp(); } }, l)));
  const tcn = (o) => typeof _mktgTC === 'function' ? _mktgTC(o) : o;
  return el('div', { class: 'card overflow-hidden', 'data-arrange-id': 'mkt-officechannel' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('h3', { class: 'text-base font-bold' }, m.t + ' by office and channel · ' + lbl),
      el('span', { class: 'ml-auto' }),
      seg(Object.keys(M).map(k => [k, M[k].t, M[k].tip]), S.metric in M ? S.metric : 'cv', (k) => { S.metric = k; }),
      fixed ? null : seg([['month', 'Month'], ['ytd', 'Year to date']], S.span, (k) => { S.span = k; })),
    (S.metric === 'spend' || S.metric === 'cac' || S.metric === 'ret') && !D.hasSpend ? el('div', { class: 'px-5 pb-2 text-[11px]', style: { color: '#B45309' } }, 'QuickBooks spend has not loaded, so there is nothing to show for this measure yet.') : null,
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Channel'), ...offices.map(o => th(tcn(o), true)), th('All offices', true))),
      el('tbody', {},
        ...channels.map(c => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
          el('td', { class: 'px-3 py-1.5 font-semibold whitespace-nowrap', style: { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1 } }, c),
          ...offices.map(o => { const cell = cellOf(o, c); return td(m.get(cell), c + ' · ' + tcn(o) + ' — click for the sales and leads', open(c + ' · ' + tcn(o), o, c, cell)); }),
          td(m.get(withLinked(D.ch[c], (o2, c2) => c2 === c)), c + ' · all offices', open(c + ' · all offices', null, c, D.ch[c]), true, 'var(--card-2)'))),
        el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } },
          el('td', { class: 'px-3 py-1.5 font-black', style: { position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1 } }, 'All channels'),
          ...offices.map(o => td(m.get(withLinked(D.br[o], (o2) => o2 === o)), tcn(o) + ' · all channels', open(tcn(o) + ' · all channels', o, null, D.br[o]), true, 'var(--card-2)')),
          td(all, 'RIDD', null, true, 'var(--card-2)'))))));
}

// Channel metrics with its Month / Year-to-date switch (per Isaac, Nov 25 — plan vs actual in one place). Month is the
// provider pulse; Year to date is the media plan's progress when the year has a plan, otherwise the same table over
// the year so far (no budget to set it against).
function mkxPulseBlock(ym, cur, RNG) {
  if (RNG) return mkxProviderPulseCard(ym, cur, RNG.label || 'range');
  const span = state._mkxPulseSpan === 'ytd' ? 'ytd' : 'month';
  const year = Number(ym.slice(0, 4)), mi = Number(ym.slice(5, 7)) - 1;
  let card = null;
  if (span === 'ytd') { try { card = typeof mkpProgressCard === 'function' ? mkpProgressCard(year) : null; } catch (e) { card = null; }
    if (!card && typeof mklRange === 'function') card = mkxProviderPulseCard(ym, mklRange(year, mi, 0), 'Jan\u2013' + new Date(year, mi, 1).toLocaleDateString('en-US', { month: 'short' }) + ' ' + year + ' (no plan for ' + year + ')'); }
  else card = mkxProviderPulseCard(ym);
  if (!card) return null;
  const seg = el('div', { class: 'ml-auto inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } }, ...[['month', 'Month'], ['ytd', 'Year to date']].map(([k, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold', style: span === k ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._mkxPulseSpan = k; mountApp(); } }, l)));
  try { const head = card.firstElementChild; if (head) { head.classList.add('flex', 'items-center', 'gap-3', 'flex-wrap'); head.appendChild(seg); } } catch (e) { /* no switch */ }
  return card;
}
