// ┌─ src/85-marketing-pulse.js ────────────────────────────────────────────
// │ Marketing → Metrics = the Marketing Pulse (per Isaac, Oct 15 — the brief in
// │ chat; Phase 1 audit published as "Marketing Pulse Data Audit"). Office Staff.
// │
// │ Definitions (each shown behind its ⓘ):
// │   Lead   = a GoHighLevel OPPORTUNITY (contacts are mostly FieldRoutes customer
// │            imports and door-to-door records). One per person per 30 days;
// │            raw opportunity events are kept next to the unique count.
// │   Sale   = an Office Staff FieldRoutes sale (initial booked or done, renewals
// │            out) whose person (normalized phone, else email) came in as a lead
// │            in the conversion window before it (30 / 60 / 90 days). Exact match
// │            only — no fuzzy name matching.
// │   Spend  = Google + Meta from the ad platforms by day (Windsor), plus every
// │            OTHER vendor from the QuickBooks lines as linked on the Spend tab.
// │            Google / Facebook QuickBooks charges are left out so nothing is
// │            counted twice. Missing data says so; it is never shown as $0.
// │   CAC    = spend ÷ sales (advertising only). Fully loaded adds agency & tools
// │            lines and the hand-entered wages / incentives, only for months that
// │            have them; otherwise it says unavailable.
// │   Revenue: contracted (contract value) and collected (payments on the account
// │            since the sale) are kept apart; ROAS is labeled with which it uses.
// │ Two reporting modes: Cohort (leads that came in the range, followed forward)
// │ and Activity (what happened in the range, by the day it happened).
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const MKP_C = { get ink() { return state.theme === 'dark' ? '#E6E6DC' : '#323230'; }, accent: '#DF643A', sage: '#5F6C5B', amber: '#B4762A', red: '#C2412D', get grid() { return state.theme === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)'; }, get txt() { return state.theme === 'dark' ? '#C9C9BE' : '#555'; } };
const MKP_PLATFORM = new Set(['Facebook', 'Google Ads', 'Google Local Services']);
const MKP_GROUPS = [['Google Ads', ['Google Ads', 'Google Local Services']], ['Meta Ads', ['Facebook']], ['Organic', ['Organic', 'PestBooker', 'Click-To-Buy']], ['Referral', ['Referral']]];
function mkpGroupOf(prov) {
  for (const [g, list] of MKP_GROUPS) if (list.includes(prov)) return g;
  if (prov === 'Unmapped') return 'Other';
  return ghlPaidSet().has(prov) ? 'Lead vendors' : 'Other';
}
const _mkpIso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
const _mkpAdd = (iso, n) => { const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() + n); return _mkpIso(d); };
const _mkpDays = (a, b) => Math.round((Date.parse(b + 'T12:00') - Date.parse(a + 'T12:00')) / 86400000) + 1;
const _mkpMs = (iso) => Date.parse(String(iso).slice(0, 10) + 'T12:00');
function mkpMarketOf(name) { const s = String(name || '').trim(); return s ? _mktgTC(s) : ''; }

// ── Filters ──────────────────────────────────────────────────────────────────
const MKP_RANGES = [['today', 'Today'], ['yesterday', 'Yesterday'], ['last_7', 'Last 7 days'], ['last_30', 'Last 30 days'], ['this_week', 'This week'], ['last_week', 'Last week'], ['this_month', 'This month'], ['last_month', 'Last month'], ['this_year', 'This year'], ['last_year', 'Last year'], ['custom', 'Custom…']];
function mkpFilters() {
  const F = state._mkp || (state._mkp = {});
  if (!MKP_RANGES.some(r => r[0] === F.range)) F.range = 'last_30';
  if (![30, 60, 90].includes(F.win)) F.win = 90;
  if (!['cohort', 'activity'].includes(F.mode)) F.mode = 'cohort';
  if (!['last', 'first'].includes(F.attr)) F.attr = 'last';
  return F;
}
function mkpRange() {
  const F = mkpFilters(), t = _mkpIso(new Date());
  let from, to = t;
  switch (F.range) {
    case 'today': from = t; break;
    case 'yesterday': from = to = _mkpAdd(t, -1); break;
    case 'last_7': from = _mkpAdd(t, -6); break;
    case 'last_30': from = _mkpAdd(t, -29); break;
    case 'custom': from = /^\d{4}-\d{2}-\d{2}$/.test(F.from || '') ? F.from : _mkpAdd(t, -29); to = /^\d{4}-\d{2}-\d{2}$/.test(F.to || '') ? F.to : t; if (from > to) { const x = from; from = to; to = x; } break;
    default: { const b = (typeof indicatorRangeBounds === 'function') ? indicatorRangeBounds(F.range) : { start: _mkpAdd(t, -29), end: t }; from = b.start; to = b.end > t ? t : b.end; }
  }
  const n = _mkpDays(from, to);
  const pTo = _mkpAdd(from, -1), pFrom = _mkpAdd(pTo, -(n - 1));
  const label = F.range === 'custom' ? fmt.dateShortYear(from) + ' – ' + fmt.dateShortYear(to) : (MKP_RANGES.find(r => r[0] === F.range) || [, 'Range'])[1];
  return { from, to, n, pFrom, pTo, label };
}

// ── Leads: GoHighLevel opportunities, deduped ────────────────────────────────
function _mkpContactIdx() {
  const G = state._ghl; if (!G || !G.rows) return null;
  const M = _mkpContactIdx._m; if (M && M.src === G.rows) return M;
  const byP = new Map(), byE = new Map();
  for (const r of G.rows) { if (r[4] && !byP.has(r[4])) byP.set(r[4], r); if (r[5] && !byE.has(r[5])) byE.set(r[5], r); }
  return (_mkpContactIdx._m = { src: G.rows, byP, byE });
}
// Every opportunity → lead record, deduped: a person's opportunity within 30 days of their last counted one is a
// repeat (a second call, a second form), not a new lead. { leads, raw } over the whole file, memoized.
function mkpAllLeads() {
  const G = state._ghl; if (!G || !G.opps) return null;
  const sig = JSON.stringify(ghlSourceMap()) + '|' + mkpFilters().attr;
  const M = mkpAllLeads._m; if (M && M.src === G.opps && M.sig === sig && M.zip === (typeof _ghlZipOffice === 'function' ? _ghlZipOffice() : null)) return M.out;
  const CI = _mkpContactIdx(), zipOff = typeof _ghlZipOffice === 'function' ? _ghlZipOffice() : new Map();
  const chSet = typeof mkmChannelSet === 'function' ? mkmChannelSet() : null;
  const lab = G.labels, paid = ghlPaidSet(), stages = G.stages || [], first = mkpFilters().attr === 'first';
  const provOf = (i) => { if (i == null || i < 0) return 'Unmapped'; const p = ghlProviderOf(lab[i]); if (!p || p === GHL_NOT_LEAD) return p === GHL_NOT_LEAD ? GHL_NOT_LEAD : 'Unmapped'; return chSet && !chSet.has(p) ? 'Unmapped' : p; };
  const sorted = G.opps.filter(o => o && o[0] && (o[2] || o[3])).slice().sort((a, b) => (a[0] + (a[4] || '')).localeCompare(b[0] + (b[4] || '')));
  const lastAt = new Map(), leads = []; let raw = 0, notLead = 0;
  for (const o of sorted) {
    const c = (o[2] && CI && CI.byP.get(o[2])) || (o[3] && CI && CI.byE.get(o[3])) || null;
    let prov = provOf(o[1]);
    if (first && c) { const fp = provOf(c[1] >= 0 ? c[1] : c[2]); if (fp && fp !== 'Unmapped' && fp !== GHL_NOT_LEAD) prov = fp; }
    if (prov === GHL_NOT_LEAD) { notLead++; continue; }
    raw++;
    const key = o[2] ? 'p' + o[2] : 'e' + o[3];
    const ms = _mkpMs(o[0]), prev = lastAt.get(key);
    if (prev != null && ms - prev < 30 * 86400000) continue;
    lastAt.set(key, ms);
    const stage = o[6] != null && o[6] >= 0 ? stages[o[6]] || '' : '';
    leads.push({ d: o[0], t: o[4] || '', p: o[2] || '', e: o[3] || '', prov, label: o[1] >= 0 ? lab[o[1]] : '', group: mkpGroupOf(prov), paid: paid.has(prov),
      campaign: o[7] != null && o[7] >= 0 ? lab[o[7]] : '', status: String(o[5] || '').toLowerCase(), stage,
      type: /forms/i.test(stage) ? 'form' : /calls/i.test(stage) ? 'call' : '', market: c ? mkpMarketOf(zipOff.get(c[6])) : '' });
  }
  const out = { leads, raw, notLead };
  mkpAllLeads._m = { src: G.opps, sig, zip: zipOff, out };
  return out;
}

// ── Spend ────────────────────────────────────────────────────────────────────
// Daily platform spend for the page's window (current + prior period), from /api/ad-spend?daily=1 (≤120 days);
// longer windows fall back to the monthly rows, pro-rated by day and labeled.
function mkpLoadDaily(from, to) {
  state._mkpDaily = state._mkpDaily || {};
  const k = from + '|' + to; const cur = state._mkpDaily[k];
  if (cur && (cur.rows || cur.loading || (cur.failAt && Date.now() - cur.failAt < 120000))) return cur;
  state._mkpDaily[k] = { loading: true };
  _apiAuthHeaders({ accept: 'application/json' })
    .then(h => fetch('/api/ad-spend?daily=1&from=' + from + '&to=' + to, { headers: h }))
    .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(j => { throw new Error(j.error || ('HTTP ' + r.status)); }))
    .then(j => { state._mkpDaily[k] = { rows: j.daily || [], errors: j.errors || [], pulledAt: j.pulledAt, from: j.from }; state._mkpMemo = null; mountApp(); })
    .catch(e => { state._mkpDaily[k] = { failAt: Date.now(), error: String((e && e.message) || e) }; mountApp(); });
  return state._mkpDaily[k];
}
// Spend lines in [from, to]: [{ d, prov, market, amt, src, campaign, clicks, impr, pLeads, kind }]
//   kind: 'ad' (counts toward advertising CAC), 'tools' (agency & tools — fully loaded only).
function mkpSpendLines(win) {
  const out = { lines: [], platform: 'none', vendor: 'none', notes: [], unlinked: 0 };
  const branchesFor = (y) => (typeof _mktgBranchList === 'function') ? _mktgBranchList(y).all : [];
  // Platforms
  const D = win.daily;
  const pushPlat = (r, d, amt) => {
    const y = Number(d.slice(0, 4)), branches = branchesFor(y);
    let offs = typeof adOfficesOf === 'function' ? adOfficesOf(r, branches).filter(b => branches.includes(b)) : [];
    let shares = null;
    if (!offs.length && typeof adGeoSplit === 'function') { const g = adGeoSplit(Object.assign({}, r, { ym: d.slice(0, 7) }), branches); if (g) { const tot = Object.values(g.by).reduce((a, v) => a + v, 0) + (g.unmapped || 0); if (tot > 0) shares = Object.entries(g.by).map(([b, v]) => [b, v / tot]).concat(g.unmapped ? [['', g.unmapped / tot]] : []); } }
    if (!shares) shares = offs.length ? offs.map(b => [b, 1 / offs.length]) : [['', 1]];
    for (const [b, f] of shares) out.lines.push({ d, prov: adProviderOf(r), market: mkpMarketOf(b), amt: amt * f, src: 'platform', campaign: r.campaign, acct: r.acctName || r.acct, platform: r.platform, clicks: (r.clicks || 0) * f, impr: (r.impr || 0) * f, pLeads: (r.leads || 0) * f, kind: 'ad', shared: !b, allocated: shares.length > 1 });
  };
  if (D && D.rows) {
    out.platform = 'daily';
    for (const r of D.rows) if (r.d >= win.from && r.d <= win.to && r.spend > 0) pushPlat(r, r.d, r.spend);
  } else {
    // Monthly fallback, pro-rated by day.
    let any = false;
    for (let y = Number(win.from.slice(0, 4)); y <= Number(win.to.slice(0, 4)); y++) {
      if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(y);
      const S = (state._adSpend || {})[y]; if (!S || !S.rows || !S.rows.some(r => r.spend > 0)) continue; any = true;
      for (const r of S.rows) {
        if (!(r.spend > 0)) continue;
        const ym = r.ym, dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate();
        const a = ym + '-01' < win.from ? win.from : ym + '-01', e = ym + '-' + String(dim).padStart(2, '0'), b = e > win.to ? win.to : e;
        if (a > b) continue;
        // One line per day of the overlap keeps the trend chart honest about the spreading.
        for (let d = a; d <= b; d = _mkpAdd(d, 1)) pushPlat(r, d, r.spend / dim);
      }
    }
    if (any) { out.platform = 'monthly'; out.notes.push('Google and Meta spend is monthly for this range, spread evenly over the days (daily pull covers up to 120 days).'); }
  }
  // QuickBooks lines: every vendor that isn't an ad platform (those come from the platforms above).
  if (typeof spqAllocMonth === 'function') {
    let any = false;
    for (let ym = win.from.slice(0, 7); ym <= win.to.slice(0, 7); ) {
      const A = spqAllocMonth(ym);
      if (A && A.lines && A.lines.length) {
        any = true;
        for (const L of A.lines) {
          const d = ym + '-' + String(L.day || '01').padStart(2, '0');
          if (d < win.from || d > win.to || L.prov === SPQ_SKIP) continue;
          if (MKP_PLATFORM.has(L.prov)) continue;   // the platform feed is the spend of record for these
          if (!L.prov) { out.unlinked += L.amt; out.lines.push({ d, prov: 'Unlinked', market: '', amt: L.amt, src: 'qbo', kind: 'ad', shared: true, payee: L.payee }); continue; }
          out.lines.push({ d, prov: L.prov === SPQ_TOOLS ? 'Agency & tools' : L.prov, market: '', amt: L.amt, src: 'qbo', kind: L.prov === SPQ_TOOLS ? 'tools' : 'ad', shared: true, payee: L.payee });
        }
      }
      const dd = new Date(ym + '-01T12:00'); dd.setMonth(dd.getMonth() + 1); ym = _mkpIso(dd).slice(0, 7);
    }
    out.vendor = any ? 'qbo' : 'none';
  }
  if (out.vendor === 'none') out.notes.push('Vendor spend (Angi, Baton, DoLead, Service Direct…) is unavailable: QuickBooks has no line detail loaded for this range.');
  return out;
}

// ── Cohort + activity model, memoized per filter set ─────────────────────────
function mkpModel() {
  const F = mkpFilters(), R = mkpRange();
  const AL = mkpAllLeads(); if (!AL) return null;
  const crm = (state.reportingSubscriptions || []).length && typeof _mkmOfficeCrmIndex === 'function' ? _mkmOfficeCrmIndex() : null;
  const winDays = F.win;
  const wFrom = R.pFrom, wTo = R.to;   // current + prior period
  const daily = R.n * 2 <= 120 ? mkpLoadDaily(wFrom, wTo) : null;
  const sig = [wFrom, wTo, winDays, F.attr, F.mode, F.market || '', F.ch || '', F.campaign || '', F.type || '', daily && daily.rows ? daily.rows.length : 'm', JSON.stringify(_spqStoreSig())].join('|');
  const M = state._mkpMemo; if (M && M.sig === sig && M.al === AL && M.subs === state.reportingSubscriptions) return M.v;
  const chOk = (l) => !F.ch || (F.ch.startsWith('g:') ? l.group === F.ch.slice(2) : l.prov === F.ch.slice(2));
  const keep = (l) => chOk(l) && (!F.market || l.market === F.market) && (!F.campaign || l.campaign === F.campaign) && (!F.type || l.type === F.type);
  // Leads that could have produced a sale in the window: from (prior start − window) to the range end.
  const lo = _mkpAdd(wFrom, -winDays);
  const pool = AL.leads.filter(l => l.d >= lo && l.d <= wTo);
  const conv = semLeadConversions(pool, crm, winDays);
  const booked = (s) => { const ist = String(s.initial_status || '').trim().toLowerCase(); return !!s.initial_serviced_date || ist === 'completed' || ist === 'pending'; };
  const notRen = (s) => typeof reportingSourceClass !== 'function' || reportingSourceClass(reportingSourceOf(s)) !== 'renewal';
  for (const x of conv) {
    const s = x.sale; x.sold = !!(x.converted && s && booked(s) && notRen(s));
    if (x.sold) { const m = x.lead.p && crm.byPhone.get(x.lead.p) ? 'phone' : 'email'; x.match = m;
      x.svc = !!(s.initial_serviced_date || String(s.initial_status || '').trim().toLowerCase() === 'completed');
      x.active = String(s.subscription_status || '').trim().toLowerCase() === 'active' && !s.subscription_date_canceled;
      x.cxl = !!s.subscription_date_canceled; x.cv = Number(s.subscription_contract_value) || 0; x.acv = Number(s.annual_recurring_value) || 0;
      x.col = s.collected_since_sale == null || s.collected_since_sale === '' ? null : Number(s.collected_since_sale) || 0;
      x.days = Math.max(0, Math.round((_mkpMs(s.sold_date) - _mkpMs(x.lead.d)) / 86400000));
      const svcD = s.initial_serviced_date || (x.svc ? s.initial_service : null); x.svcDays = svcD ? Math.max(0, Math.round((_mkpMs(svcD) - _mkpMs(x.lead.d)) / 86400000)) : null; }
  }
  const SP = mkpSpendLines({ from: wFrom, to: wTo, daily });
  const spOk = (s) => (!F.ch || (F.ch.startsWith('g:') ? mkpGroupOf(s.prov) === F.ch.slice(2) : s.prov === F.ch.slice(2))) && (!F.market || s.market === F.market) && (!F.campaign || s.campaign === F.campaign);
  const spendIn = (a, b, kind) => SP.lines.filter(s => s.d >= a && s.d <= b && (kind ? s.kind === kind : true) && spOk(s));
  // A period's numbers, in the page's mode.
  const period = (a, b) => {
    const cohort = conv.filter(x => x.lead.d >= a && x.lead.d <= b && keep(x.lead));
    const sales = F.mode === 'cohort' ? cohort.filter(x => x.sold) : conv.filter(x => x.sold && keep(x.lead) && String(x.sale.sold_date).slice(0, 10) >= a && String(x.sale.sold_date).slice(0, 10) <= b);
    const ad = spendIn(a, b, 'ad').reduce((t, s) => t + s.amt, 0), tools = spendIn(a, b, 'tools').reduce((t, s) => t + s.amt, 0);
    const custSeen = new Set(); let col = 0, colKnown = 0;
    for (const x of sales) { const c = String(x.sale.customer_id); if (custSeen.has(c)) continue; custSeen.add(c); if (x.col != null) { col += x.col; colKnown++; } }
    return { leads: cohort, sales, n: cohort.length, s: sales.length, ad, tools, cv: sales.reduce((t, x) => t + x.cv, 0), acv: sales.reduce((t, x) => t + x.acv, 0), col: colKnown ? col : null };
  };
  const cur = period(R.from, R.to), prev = period(R.pFrom, R.pTo);
  // Fully loaded: wages / incentives as hand-entered by month (only when every month in range has them).
  const store = typeof _mktgStore === 'function' ? _mktgStore() : null;
  const labor = (() => { if (!store) return null; let t = 0, missing = 0; for (let ym = R.from.slice(0, 7); ym <= R.to.slice(0, 7); ) { const w = store.wages[ym] || {}, inc = store.incentives[ym] || {}; const s = Object.values(w).reduce((a, v) => a + (Number(v) || 0), 0) + Object.values(inc).reduce((a, v) => a + (Number(v) || 0), 0); if (!s) missing++; const dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate(); const ov = Math.max(0, _mkpDays(ym + '-01' < R.from ? R.from : ym + '-01', (ym + '-' + String(dim).padStart(2, '0')) > R.to ? R.to : ym + '-' + String(dim).padStart(2, '0'))); t += s * ov / dim; const dd = new Date(ym + '-01T12:00'); dd.setMonth(dd.getMonth() + 1); ym = _mkpIso(dd).slice(0, 7); } return missing ? null : t; })();
  const unlinkedCur = spendIn(R.from, R.to).filter(x => x.prov === 'Unlinked').reduce((t, x) => t + x.amt, 0);
  const v = { R, F, AL, conv, SP, unlinkedCur, cur, prev, labor, daily, crm, keep, spOk, period, spendIn, hasSpend: SP.platform !== 'none', prevSpendOk: prev.ad > 0 };
  state._mkpMemo = { sig, al: AL, subs: state.reportingSubscriptions, v };
  return v;
}
function _spqStoreSig() { try { const m = _mktgStore(); return [Object.keys(m.qbRules || {}).length, (state.reportingIsSpendPayee && state.reportingIsSpendPayee.pulledAt) || '']; } catch (e) { return []; } }

// ── UI helpers ───────────────────────────────────────────────────────────────
const _mkpMuted = { color: 'var(--text-muted)' };
function _mkpInfo(title, desc) { const b = el('span', { class: 'inline-flex items-center justify-center rounded-full text-[9px] font-bold ml-1', style: { width: '14px', height: '14px', background: 'var(--card-2)', color: 'var(--text-muted)', cursor: 'help' } }, 'i'); if (typeof attachExplainer === 'function') attachExplainer(b, { title, desc }); else b.title = desc; return b; }
function _mkpDelta(cur, prev, betterUp) {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev) || prev === 0) return el('span', { class: 'text-[10px]', style: { color: 'var(--text-subtle)' } }, prev === 0 && cur ? 'new vs prior' : prev == null && cur != null ? 'no prior data' : '— vs prior');
  const ch = (cur - prev) / Math.abs(prev), good = betterUp ? ch >= 0 : ch <= 0;
  return el('span', { class: 'text-[10px] font-semibold tabular-nums', style: { color: Math.abs(ch) < 0.005 ? 'var(--text-muted)' : good ? MKP_C.sage : MKP_C.red } }, (ch >= 0 ? '▲ ' : '▼ ') + Math.abs(Math.round(ch * 100)) + '% vs prior');
}
function _mkpSpark(vals, color) {
  const W = 120, H = 28, v = vals.map(x => x == null || !isFinite(x) ? null : x), ok = v.filter(x => x != null);
  if (ok.length < 2) return null;
  const mx = Math.max(...ok), mn = Math.min(0, ...ok), sx = (i) => (i / (v.length - 1)) * (W - 2) + 1, sy = (x) => H - 2 - ((x - mn) / ((mx - mn) || 1)) * (H - 4);
  let d = ''; v.forEach((x, i) => { if (x == null) return; d += (d ? ' L' : 'M') + sx(i).toFixed(1) + ' ' + sy(x).toFixed(1); });
  const last = v.length - 1 - [...v].reverse().findIndex(x => x != null);
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('width', '100%'); svg.setAttribute('height', String(H)); svg.setAttribute('preserveAspectRatio', 'none');
  svg.innerHTML = '<path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>' + '<circle cx="' + sx(last) + '" cy="' + sy(v[last]) + '" r="2.2" fill="' + color + '"/>';
  return el('div', { style: { marginTop: '6px', opacity: '.9' } }, svg);
}
const _mkpUsd = (v) => v == null || !isFinite(v) ? '—' : fmt.usd0(v);
const _mkpPct = (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%';
// Records drawer: the leads / sales behind a number.
function mkpOpenRecords(title, rows, kind) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey); overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: { color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: '0' } }, t);
  const td = (v, st) => el('td', { class: 'px-2 py-1.5 whitespace-nowrap tabular-nums', style: st || {} }, v == null || v === '' ? '—' : v);
  const name = (s) => s ? [String(s.first_name || '').trim(), String(s.last_name || '').trim()].filter(Boolean).join(' ') : '';
  const csv = () => { const esc = (v) => '"' + String(v == null ? '' : v).replace(/"/g, '""') + '"';
    const L = [['Lead date', 'Channel', 'GHL source', 'Campaign', 'Market', 'Opportunity', 'Customer', 'Sold', 'Contract value', 'Service', 'Match'].join(',')];
    for (const x of rows) { const s = x.sale; L.push([x.lead.d, x.lead.prov, x.lead.label, x.lead.campaign, x.lead.market, x.lead.status, x.sold ? name(s) : '', x.sold ? String(s.sold_date).slice(0, 10) : '', x.sold ? x.cv.toFixed(2) : '', x.sold ? (x.svc ? 'Serviced' : 'Booked') : '', x.sold ? x.match : ''].map(esc).join(',')); }
    const url = URL.createObjectURL(new Blob([L.join('\n')], { type: 'text/csv' })); const a = el('a', { href: url, download: 'ridd-marketing-' + title.replace(/[^a-z0-9]+/gi, '-').toLowerCase() + '.csv' }); document.body.append(a); a.click(); a.remove(); URL.revokeObjectURL(url); };
  const card = el('div', { class: 'card', style: { width: 'min(1100px, 96vw)', maxHeight: '86vh', display: 'flex', flexDirection: 'column', background: 'var(--card)' } },
    el('div', { class: 'flex items-center gap-3 px-4 py-3 border-b', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'flex-1 min-w-0' }, el('div', { class: 'text-sm font-bold' }, title), el('div', { class: 'text-[11px]', style: _mkpMuted }, fmt.int(rows.length) + ' record' + (rows.length === 1 ? '' : 's') + (rows.length > 1500 ? ' · first 1,500 shown, CSV has all' : '') + ' · matched on normalized phone, else email; no fuzzy matches')),
      el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: csv }, '⬇ CSV'),
      el('button', { class: 'text-xl leading-none', style: _mkpMuted, onclick: close, title: 'Close' }, '×')),
    el('div', { style: { overflow: 'auto' } }, el('table', { class: 'w-full text-[11px]', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Lead date'), th('Channel'), th('Campaign'), th('Market'), th('GHL status'), th('Customer'), th('Sold'), th('Contract'), th('Service'), th('Match'))),
      el('tbody', {}, ...rows.slice(0, 1500).map(x => { const s = x.sale; return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(x.lead.d), td(x.lead.prov, { fontWeight: '600' }), td(x.lead.campaign || '', _mkpMuted), td(x.lead.market || '', _mkpMuted), td(x.lead.status || 'open'),
        td(x.sold ? name(s) : ''), td(x.sold ? String(s.sold_date).slice(0, 10) : (x.converted ? 'sold, not booked' : 'not yet'), x.sold ? {} : _mkpMuted), td(x.sold ? fmt.usd0(x.cv) : ''),
        td(x.sold ? (x.cxl ? 'Cancelled' : x.svc ? 'Serviced' : 'Booked') : ''), td(x.sold ? x.match : '')); })))));
  overlay.append(card); document.body.append(overlay);
}

// ── The page ─────────────────────────────────────────────────────────────────
function mktgPulseView() {
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  const F = mkpFilters();
  const G = state._ghl;
  if (!G || !G.opps) return el('div', { class: 'card p-6 text-sm', style: _mkpMuted }, G === null || G === undefined ? 'Loading GoHighLevel…' : 'No GoHighLevel opportunities yet — the GoHighLevel sync fills this in.');
  let V; try { V = mkpModel(); } catch (e) { console.warn('[pulse] model failed', e); return el('div', { class: 'card p-6 text-sm' }, 'Marketing Pulse hit an error: ' + (e.message || e)); }
  if (!V) return el('div', { class: 'card p-6 text-sm', style: _mkpMuted }, 'Loading…');
  const { R, cur, prev, SP } = V;
  const setF = (patch) => { Object.assign(state._mkp, patch); state._mkpMemo = null; mountApp(); };
  const selSt = (on) => ({ borderColor: on ? 'var(--accent)' : 'var(--border-2)', background: on ? 'var(--accent)' : 'var(--card)', color: on ? 'var(--accent-text)' : 'var(--text)' });
  const sel = (val, opts, on, title, onchange, minW) => el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer', style: Object.assign(selSt(on), minW ? { minWidth: minW } : {}), title, onchange: (e) => onchange(e.target.value) },
    ...opts.map(o => Array.isArray(o[1]) ? el('optgroup', { label: o[0] }, ...o[1].map(([v, l]) => el('option', { value: v, selected: v === val }, l))) : el('option', { value: o[0], selected: o[0] === val, disabled: !!o[2] }, o[1])));
  // Filter options from the data in the window.
  const inWin = V.conv.filter(x => x.lead.d >= R.pFrom && x.lead.d <= R.to);
  const markets = [...new Set(inWin.map(x => x.lead.market).filter(Boolean).concat(SP.lines.map(s => s.market).filter(Boolean)))].sort();
  const provs = [...new Set(inWin.map(x => x.lead.prov).concat(SP.lines.map(s => s.prov)))].filter(Boolean).sort();
  const groups = [...new Set(provs.map(mkpGroupOf))];
  const camps = [...new Set(inWin.map(x => x.lead.campaign).filter(Boolean))].sort();
  const hasType = inWin.some(x => x.lead.type);
  const bar = el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' },
    sel(F.range, MKP_RANGES, false, 'Date range', (v) => setF(v === 'custom' ? { range: v, from: R.from, to: R.to } : { range: v }), '120px'),
    F.range === 'custom' ? el('input', { type: 'date', value: R.from, class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: selSt(false), onchange: (e) => setF({ from: e.target.value }) }) : null,
    F.range === 'custom' ? el('input', { type: 'date', value: R.to, class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: selSt(false), onchange: (e) => setF({ to: e.target.value }) }) : null,
    el('span', { class: 'text-[11px] tabular-nums', style: _mkpMuted }, fmt.dateShort(R.from) + (R.n > 1 ? ' – ' + fmt.dateShort(R.to) : '') + ' · vs ' + fmt.dateShort(R.pFrom) + (R.n > 1 ? ' – ' + fmt.dateShort(R.pTo) : '')),
    el('span', { style: { flex: '1' } }),
    sel(F.market || '', [['', 'All markets'], ...markets.map(m => [m, m])], !!F.market, 'Market', (v) => setF({ market: v })),
    sel(F.ch || '', [['', 'All channels'], ['Channel groups', groups.map(g => ['g:' + g, g])], ['Channels', provs.map(p => ['p:' + p, p])]], !!F.ch, 'Channel', (v) => setF({ ch: v })),
    sel(F.campaign || '', [['', camps.length ? 'All campaigns' : 'Campaigns (none tracked yet)'], ...camps.slice(0, 300).map(c => [c, c.slice(0, 48)])], !!F.campaign, camps.length ? 'Campaign (from the lead’s UTM / attribution in GoHighLevel)' : 'Campaigns appear once the GoHighLevel sync stores them (migration 20261015g)', (v) => setF({ campaign: v })),
    sel(F.type || '', [['', 'Calls + forms'], ['call', 'Calls', !hasType], ['form', 'Forms', !hasType]], !!F.type, hasType ? 'Lead type — from the GHL pipeline stage, only known while the opportunity is still in a New Lead stage' : 'Call vs form isn’t tracked yet: GoHighLevel only shows it as the current pipeline stage', (v) => setF({ type: v })),
    sel(F.attr, [['last', 'Last touch'], ['first', 'First touch']], false, 'Attribution: last touch = the opportunity’s source; first touch = the contact’s original source (never overwritten)', (v) => setF({ attr: v })),
    sel(String(F.win), [['30', '30-day window'], ['60', '60-day window'], ['90', '90-day window']], false, 'Conversion window: a sale counts for a lead when it is sold within this many days of it', (v) => setF({ win: Number(v) })),
    el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } }, ...[['cohort', 'Cohort'], ['activity', 'Activity']].map(([v, l]) => el('button', { class: 'px-2 py-1 text-[11px] font-semibold', title: v === 'cohort' ? 'Cohort: the leads that came in during the range, followed to their sales' : 'Activity: lead-sourced sales sold during the range, whenever the lead came in', style: F.mode === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => setF({ mode: v }) }, l))));
  // Freshness strip.
  const fresh = [];
  const ago = (iso) => { if (!iso) return null; const h = (Date.now() - Date.parse(iso)) / 3600000; return h < 1 ? Math.max(1, Math.round(h * 60)) + 'm ago' : h < 48 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
  const fItem = (label, iso, warn, msg) => el('span', { class: 'inline-flex items-center gap-1', title: msg || '' }, el('span', { style: { width: '6px', height: '6px', borderRadius: '50%', background: warn ? MKP_C.red : MKP_C.sage, display: 'inline-block' } }), label + ' ' + (iso ? ago(iso) : warn ? 'not loaded' : 'loaded'));
  fresh.push(fItem('GoHighLevel', G.at, !G.at || Date.now() - Date.parse(G.at) > 3 * 3600000));
  const dl = V.daily; fresh.push(fItem('Google + Meta', dl && dl.pulledAt ? dl.pulledAt : ((state._adSpend || {})[new Date().getFullYear()] || {}).pulledAt, SP.platform === 'none' || !!(dl && dl.error), dl && dl.error ? dl.error : SP.platform === 'monthly' ? 'monthly, spread by day' : ''));
  fresh.push(fItem('QuickBooks lines', state.reportingIsSpendPayee && state.reportingIsSpendPayee.pulledAt, SP.vendor === 'none', SP.vendor === 'none' ? 'no line detail loaded' : ''));
  fresh.push(fItem('FieldRoutes', state._snapshotAt || state.reportingSnapshotAt || null, !(state.reportingSubscriptions || []).length));
  const freshStrip = el('div', { class: 'flex items-center gap-4 flex-wrap text-[10px]', style: _mkpMuted }, el('span', { class: 'uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Data'), ...fresh,
    ...SP.notes.map(n => el('span', { style: { color: MKP_C.amber } }, '⚠ ' + n)));

  // ── 1 · KPI cards ──
  const adOnly = V.hasSpend ? cur.ad : null, pAd = V.hasSpend && V.prevSpendOk ? prev.ad : null;
  const spendCaveat = SP.platform === 'none' ? 'Google + Meta unavailable' : SP.vendor === 'none' ? 'Google + Meta only — vendor spend unavailable' : 'Google + Meta (platforms) + vendors (QuickBooks)';
  const days = []; for (let d = R.from; d <= R.to; d = _mkpAdd(d, 1)) days.push(d);
  const sparkBy = (fn) => R.n >= 4 && R.n <= 120 ? days.map(fn) : null;
  const leadsByDay = new Map(); cur.leads.forEach(x => leadsByDay.set(x.lead.d, (leadsByDay.get(x.lead.d) || 0) + 1));
  const salesByDay = new Map(); cur.sales.forEach(x => { const k = F.mode === 'cohort' ? x.lead.d : String(x.sale.sold_date).slice(0, 10); salesByDay.set(k, (salesByDay.get(k) || 0) + 1); });
  const spendByDay = new Map(); V.spendIn(R.from, R.to, 'ad').forEach(s => spendByDay.set(s.d, (spendByDay.get(s.d) || 0) + s.amt));
  const fullyLoaded = V.hasSpend && V.labor != null ? cur.ad + cur.tools + V.labor : null;
  const kpi = (label, value, delta, spark, info, onClick, sub) => el('button', { type: 'button', class: 'card p-4 text-left transition hover:brightness-95', style: { cursor: onClick ? 'pointer' : 'default', minWidth: '0' }, onclick: onClick || null },
    el('div', { class: 'flex items-center text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, label, info),
    el('div', { class: 'text-2xl font-black tabular-nums mt-1', style: { color: value === 'Data unavailable' ? 'var(--text-muted)' : 'var(--text)', fontSize: value === 'Data unavailable' ? '15px' : undefined } }, value),
    el('div', { class: 'mt-0.5' }, delta), sub ? el('div', { class: 'text-[10px] mt-0.5', style: _mkpMuted }, sub) : null, spark);
  const salesLbl = F.mode === 'cohort' ? 'Sales from these leads' : 'Lead-sourced sales';
  const cards = el('div', { style: { display: 'grid', gap: '12px', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))' } },
    kpi('Marketing spend', V.hasSpend ? _mkpUsd(adOnly) : 'Data unavailable', V.hasSpend ? _mkpDelta(adOnly, pAd, false) : null, sparkBy(d => spendByDay.get(d) || 0) && _mkpSpark(sparkBy(d => spendByDay.get(d) || 0), MKP_C.ink),
      _mkpInfo('Marketing spend', 'Advertising spend in the range. Google Ads and Meta come from the ad platforms (by day when the range is up to 60 days, else monthly spread by day); every other vendor comes from the QuickBooks lines as linked on the Spend tab. Google and Facebook QuickBooks charges are left out so nothing is counted twice. Agency & tools lines are not advertising; they only go into fully loaded CAC.'), null, spendCaveat),
    kpi('New leads', fmt.int(cur.n), _mkpDelta(cur.n, prev.n, true), _mkpSpark(sparkBy(d => leadsByDay.get(d) || 0) || [], MKP_C.ink),
      _mkpInfo('New leads', 'GoHighLevel opportunities opened in the range: the inbound lead record (contacts are mostly customer imports). One per person per 30 days — a second call or form from the same phone / email inside 30 days is a repeat. Every opportunity counts as qualified until GoHighLevel sends a qualified flag. ' + fmt.int(V.AL.raw) + ' raw opportunity events on file → ' + fmt.int(V.AL.leads.length) + ' unique leads.'), () => mkpOpenRecords('New leads · ' + R.label, cur.leads), cur.leads.filter(x => x.lead.paid).length + ' from paid channels'),
    kpi('Cost per lead', V.hasSpend && cur.n ? _mkpUsd(cur.ad / cur.n) : V.hasSpend ? '—' : 'Data unavailable', V.hasSpend ? _mkpDelta(cur.n ? cur.ad / cur.n : null, prev.n && V.prevSpendOk ? prev.ad / prev.n : null, false) : null, null,
      _mkpInfo('Cost per lead', 'Marketing spend ÷ new leads, for the same channels and market. Organic leads are in the count, so the all-channel CPL reads lower than a paid-only CPL; pick a channel to see its own.'), null, F.ch ? '' : 'all leads, organic included'),
    kpi(salesLbl, fmt.int(cur.s), _mkpDelta(cur.s, prev.s, true), _mkpSpark(sparkBy(d => salesByDay.get(d) || 0) || [], MKP_C.accent),
      _mkpInfo('Sales', 'Office Staff FieldRoutes sales (initial booked or done, renewals left out) whose person — normalized phone, else email — came in as a lead within the ' + F.win + '-day window before the sale. Exact matches only. ' + (F.mode === 'cohort' ? 'Cohort mode: sales from the leads that came in during the range, whenever they sold.' : 'Activity mode: lead-sourced sales sold during the range.')), () => mkpOpenRecords(salesLbl + ' · ' + R.label, cur.sales), fmt.usd0(cur.cv) + ' contracted'),
    kpi('CAC', V.hasSpend && cur.s ? _mkpUsd(cur.ad / cur.s) : V.hasSpend ? '—' : 'Data unavailable', V.hasSpend ? _mkpDelta(cur.s ? cur.ad / cur.s : null, prev.s && V.prevSpendOk ? prev.ad / prev.s : null, false) : null, null,
      _mkpInfo('Customer acquisition cost', 'Advertising-only CAC: marketing spend ÷ sales. Fully loaded CAC adds agency & tools lines and the wages / incentives entered on the Spend tab; it shows only when every month in the range has wages entered.'), null,
      fullyLoaded != null && cur.s ? 'fully loaded ' + _mkpUsd(fullyLoaded / cur.s) : 'advertising only · fully loaded unavailable'),
    kpi('Lead → sale', cur.n ? _mkpPct(cur.leads.filter(x => x.sold).length / cur.n) : '—', _mkpDelta(cur.n ? cur.leads.filter(x => x.sold).length / cur.n : null, prev.n ? prev.leads.filter(x => x.sold).length / prev.n : null, true), null,
      _mkpInfo('Lead-to-sale conversion', 'Of the leads that came in during the range, the share that became a sale within the ' + F.win + '-day window. Leads younger than the window can still convert, so recent ranges read low — the card says how many are still maturing.'), null,
      (() => { const young = cur.leads.filter(x => Date.now() - _mkpMs(x.lead.d) < F.win * 86400000).length; return young ? fmt.int(young) + ' leads still inside the window' : 'all leads past the window'; })()));

  // ── 2 · Trend ──
  const TM = [['spend', 'Spend'], ['leads', 'Leads'], ['sales', 'Sales'], ['cpl', 'CPL'], ['cac', 'CAC'], ['conv', 'Conversion'], ['rev', 'Revenue'], ['roas', 'ROAS']];
  const tm = TM.some(t => t[0] === F.trend) ? F.trend : 'leads';
  const span = R.n, autoGrain = span <= 45 ? 'day' : span <= 210 ? 'week' : 'month';
  const grain = ['day', 'week', 'month'].includes(F.grain) ? F.grain : autoGrain;
  const keyOf = (iso) => { iso = String(iso).slice(0, 10); if (grain === 'day') return iso; if (grain === 'month') return iso.slice(0, 7); const d = new Date(iso + 'T12:00'); d.setDate(d.getDate() - d.getDay()); return _mkpIso(d); };
  const bucket = (a, b, P) => { const B = new Map(); for (let d = a; d <= b; d = _mkpAdd(d, 1)) { const k = keyOf(d); if (!B.has(k)) B.set(k, { sp: 0, n: 0, s: 0, cv: 0, ns: 0 }); }
    for (const x of P.leads) { const o = B.get(keyOf(x.lead.d)); if (o) { o.n++; if (x.sold) o.ns++; } }
    for (const x of P.sales) { const o = B.get(keyOf(F.mode === 'cohort' ? x.lead.d : x.sale.sold_date)); if (o) { o.s++; o.cv += x.cv; } }
    for (const s of V.spendIn(a, b, 'ad')) { const o = B.get(keyOf(s.d)); if (o) o.sp += s.amt; }
    return [...B.values()]; };
  const cb = bucket(R.from, R.to, cur), pb = bucket(R.pFrom, R.pTo, prev);
  const valOf = (o) => tm === 'spend' ? (V.hasSpend ? o.sp : null) : tm === 'leads' ? o.n : tm === 'sales' ? o.s : tm === 'cpl' ? (V.hasSpend && o.n ? o.sp / o.n : null) : tm === 'cac' ? (V.hasSpend && o.s ? o.sp / o.s : null) : tm === 'conv' ? (o.n ? o.ns / o.n * 100 : null) : tm === 'rev' ? o.cv : (V.hasSpend && o.sp ? o.cv / o.sp : null);
  const cbKeys = (() => { const ks = []; const seen = new Set(); for (let d = R.from; d <= R.to; d = _mkpAdd(d, 1)) { const k = keyOf(d); if (!seen.has(k)) { seen.add(k); ks.push(k); } } return ks; })();
  const kLbl = (k) => grain === 'month' ? new Date(k + '-01T12:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }) : new Date(k + 'T12:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  const fmtV = (v) => v == null ? '—' : ['spend', 'cpl', 'cac', 'rev'].includes(tm) ? fmt.usd0(v) : tm === 'conv' ? v.toFixed(1) + '%' : tm === 'roas' ? v.toFixed(2) + 'x' : fmt.int(v);
  const idT = 'mkpTrend';
  setTimeout(() => {
    if (typeof Chart === 'undefined') return; const c = document.getElementById(idT); if (!c) return;
    if (_chartInstances[idT]) { _chartInstances[idT].destroy(); delete _chartInstances[idT]; }
    const bars = ['spend', 'leads', 'sales', 'rev'].includes(tm);
    _chartInstances[idT] = new Chart(c.getContext('2d'), { data: { labels: cbKeys.map(kLbl), datasets: [
        { type: bars ? 'bar' : 'line', label: R.label, data: cb.map(valOf), backgroundColor: tm === 'sales' || tm === 'rev' ? MKP_C.accent : MKP_C.ink, borderColor: tm === 'sales' || tm === 'rev' ? MKP_C.accent : MKP_C.ink, borderWidth: bars ? 0 : 2.4, borderRadius: 2, tension: 0.3, pointRadius: bars ? 0 : 2, spanGaps: true, order: 2 },
        { type: 'line', label: 'Prior period', data: pb.slice(0, cb.length).map(valOf), borderColor: MKP_C.sage, backgroundColor: MKP_C.sage, borderDash: [5, 4], borderWidth: 1.6, pointRadius: 0, tension: 0.3, spanGaps: true, order: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: MKP_C.txt, boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (x) => ' ' + x.dataset.label + ': ' + fmtV(x.parsed.y) } } },
        scales: { x: { grid: { display: false }, ticks: { color: MKP_C.txt, font: { size: 10 }, maxTicksLimit: 14, maxRotation: 0 } }, y: { beginAtZero: true, grid: { color: MKP_C.grid }, ticks: { color: MKP_C.txt, font: { size: 10 }, callback: (v) => fmtV(v) } } } } });
  }, 40);
  const pill = (on, label, click, title) => el('button', { class: 'px-2 py-1 text-[11px] font-semibold', title: title || '', style: on ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: click }, label);
  const trend = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'text-sm font-bold' }, 'Performance trend'),
      el('div', { class: 'inline-flex rounded-lg border overflow-hidden flex-wrap', style: { borderColor: 'var(--border-2)' } }, ...TM.map(([v, l]) => pill(tm === v, l, () => setF({ trend: v })))),
      el('span', { style: { flex: '1' } }),
      el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } }, ...[['day', 'Daily'], ['week', 'Weekly'], ['month', 'Monthly']].map(([v, l]) => pill(grain === v, l, () => setF({ grain: v }))))),
    el('div', { class: 'p-3', style: { height: '280px' } }, el('canvas', { id: idT })),
    el('div', { class: 'px-4 pb-3 text-[10px]', style: _mkpMuted }, (F.mode === 'cohort' ? 'Leads, sales and revenue are placed on the day the lead came in. ' : 'Sales and revenue are placed on the day they sold. ') + 'The dashed line is the prior period of the same length.' + (SP.platform === 'monthly' ? ' Spend is monthly, spread by day.' : '')));

  // ── 3 · Funnel ──
  const L = cur.leads, sold = L.filter(x => x.sold), svc = sold.filter(x => x.svc), act = svc.filter(x => x.active), cxl = sold.filter(x => x.cxl);
  const med = (a) => { const v = a.filter(x => x != null).sort((p, q) => p - q); return v.length ? v[Math.floor(v.length / 2)] : null; };
  const avg = (a) => { const v = a.filter(x => x != null); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
  const waiting = L.filter(x => !x.sold && Date.now() - _mkpMs(x.lead.d) < F.win * 86400000).length;
  const steps = [['Inbound lead', L, 'New leads'], ['Sold', sold, 'Office Staff sale with the initial booked or done'], ['Serviced', svc, 'Initial service completed'], ['Active customer', act, 'Plan still active, no cancel date']];
  const funnel = el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-center justify-between gap-3 flex-wrap mb-3' }, el('div', {}, el('div', { class: 'text-sm font-bold' }, 'Lead-to-customer funnel'),
      el('div', { class: 'text-[11px]', style: _mkpMuted }, 'The leads that came in ' + R.label.toLowerCase() + ', followed forward. "Contacted" isn’t shown: no call or message events are synced, so it can’t be measured yet.'))),
    el('div', { class: 'flex flex-col gap-2' }, ...steps.map(([lbl, rows, tip], i) => el('button', { type: 'button', class: 'flex items-center gap-3 text-left', title: tip + ' — click for the records', onclick: () => mkpOpenRecords(lbl + ' · ' + R.label, rows) },
      el('div', { class: 'text-[11px] font-semibold', style: { width: '120px', flexShrink: '0' } }, lbl),
      el('div', { style: { flex: '1', minWidth: '0', background: 'var(--card-2)', borderRadius: '4px', height: '22px' } }, el('div', { style: { width: (L.length ? Math.max(0.6, rows.length / L.length * 100) : 0) + '%', height: '100%', borderRadius: '4px', background: i === 0 ? MKP_C.ink : i === steps.length - 1 ? MKP_C.sage : MKP_C.accent, opacity: i === 2 ? '.8' : '1' } })),
      el('div', { class: 'text-[11px] tabular-nums', style: { width: '170px', flexShrink: '0' } }, fmt.int(rows.length) + (i ? ' · ' + _mkpPct(rows.length / (L.length || 1)) + ' of leads' + (i > 1 ? ' · ' + _mkpPct(rows.length / (steps[i - 1][1].length || 1)) + ' of prev' : '') : ''))))),
    el('div', { class: 'flex gap-6 flex-wrap mt-3 text-[11px]', style: _mkpMuted },
      el('span', {}, 'Time to sale: median ', el('b', { style: { color: 'var(--text)' } }, med(sold.map(x => x.days)) == null ? '—' : med(sold.map(x => x.days)) + 'd'), ' · avg ' + (avg(sold.map(x => x.days)) == null ? '—' : avg(sold.map(x => x.days)).toFixed(1) + 'd')),
      el('span', {}, 'Time to first service: median ', el('b', { style: { color: 'var(--text)' } }, med(svc.map(x => x.svcDays)) == null ? '—' : med(svc.map(x => x.svcDays)) + 'd'), ' · avg ' + (avg(svc.map(x => x.svcDays)) == null ? '—' : avg(svc.map(x => x.svcDays)).toFixed(1) + 'd')),
      el('span', {}, el('b', { style: { color: 'var(--text)' } }, fmt.int(waiting)), ' leads still inside the ' + F.win + '-day window'),
      el('span', {}, el('b', { style: { color: cxl.length ? MKP_C.red : 'var(--text)' } }, fmt.int(cxl.length)), ' sold then cancelled (' + _mkpPct(sold.length ? cxl.length / sold.length : null) + ')')));

  // ── 4 · Channels ──
  const rowsBy = (keyFn, spendKeyFn) => {
    const m = new Map();
    const get = (k) => m.get(k) || m.set(k, { k, n: 0, s: 0, cv: 0, sp: 0, pn: 0, ps: 0, psp: 0 }).get(k);
    for (const x of cur.leads) get(keyFn(x.lead)).n++;
    for (const x of cur.sales) { const o = get(keyFn(x.lead)); o.s++; o.cv += x.cv; }
    for (const x of prev.leads) get(keyFn(x.lead)).pn++;
    for (const x of prev.sales) get(keyFn(x.lead)).ps++;
    for (const s of V.spendIn(R.from, R.to, 'ad')) get(spendKeyFn(s)).sp += s.amt;
    for (const s of V.spendIn(R.pFrom, R.pTo, 'ad')) get(spendKeyFn(s)).psp += s.amt;
    return [...m.values()];
  };
  const chRows = rowsBy(l => l.prov || 'Unmapped', s => s.prov).sort((a, b) => b.sp - a.sp || b.n - a.n);
  const sortTable = (rows, key) => { const k = state._mkpSort && state._mkpSort[key]; if (!k) return rows; const val = (r) => ({ sp: r.sp, n: r.n, cpl: r.n && r.sp ? r.sp / r.n : null, s: r.s, close: r.n ? r.s / r.n : null, cac: r.s && r.sp ? r.sp / r.s : null, cv: r.cv, roas: r.sp ? r.cv / r.sp : null })[k]; return rows.slice().sort((a, b) => { const x = val(a), y = val(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return ['cpl', 'cac'].includes(k) ? x - y : y - x; }); };
  const th = (t, tbl, k, tip) => el('th', { class: 'px-3 py-2 text-left text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap' + (k ? ' cursor-pointer' : ''), title: tip || '', style: { color: (state._mkpSort || {})[tbl] === k && k ? 'var(--text)' : 'var(--text-muted)', background: 'var(--card-2)' }, onclick: k ? () => { state._mkpSort = Object.assign({}, state._mkpSort || {}, { [tbl]: k }); mountApp(); } : null }, t);
  const td = (v, st) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap tabular-nums', style: st || {} }, v == null || v === '' ? '—' : v);
  const trendTag = (r) => { if (!(r.s >= 5 && r.ps >= 5 && r.sp && r.psp)) return null; const c1 = r.sp / r.s, c0 = r.psp / r.ps, ch = (c1 - c0) / c0; if (Math.abs(ch) < 0.2) return null; return el('span', { class: 'ml-1 text-[9px] font-bold', style: { color: ch > 0 ? MKP_C.red : MKP_C.sage }, title: 'CAC ' + (ch > 0 ? 'up' : 'down') + ' ' + Math.round(Math.abs(ch) * 100) + '% vs the prior period' }, ch > 0 ? '▲CAC' : '▼CAC'); };
  const metricCells = (r, noSpendWhy) => [
    td(r.sp ? fmt.usd0(r.sp) : (noSpendWhy || '—'), r.sp ? {} : { color: 'var(--text-subtle)' }), td(fmt.int(r.n)), td(r.n && r.sp ? fmt.usd0(r.sp / r.n) : '—'), td(fmt.int(r.s)), td(r.n ? _mkpPct(r.s / r.n) : '—'),
    el('td', { class: 'px-3 py-1.5 whitespace-nowrap tabular-nums' }, r.s && r.sp ? fmt.usd0(r.sp / r.s) : '—', trendTag(r)), td(r.cv ? fmt.usd0(r.cv) : '—'),
    td(r.sp ? (r.cv / r.sp).toFixed(2) + 'x' : '—', r.sp ? { color: r.cv / r.sp >= 1 ? MKP_C.sage : MKP_C.red, fontWeight: '600' } : {})];
  const best = (rows, f, low) => { const c = rows.filter(r => f(r) != null); if (!c.length) return null; return c.reduce((a, b) => (low ? f(b) < f(a) : f(b) > f(a)) ? b : a); };
  const minLead = (r) => r.n >= 10;
  const bCPL = best(chRows.filter(r => r.sp && minLead(r)), r => r.sp / r.n, true), bCAC = best(chRows.filter(r => r.sp && r.s >= 3), r => r.sp / r.s, true), bS = best(chRows, r => r.s || null), bRev = best(chRows, r => r.cv || null);
  const openCh = state._mkpOpenCh || '';
  const campRows = (prov) => { const m = new Map(); for (const s of V.spendIn(R.from, R.to, 'ad')) { if (s.prov !== prov || !s.campaign) continue; const o = m.get(s.campaign) || m.set(s.campaign, { k: s.campaign, sp: 0, clicks: 0, impr: 0, pl: 0, n: 0, s: 0, cv: 0, acct: s.acct }).get(s.campaign); o.sp += s.amt; o.clicks += s.clicks || 0; o.impr += s.impr || 0; o.pl += s.pLeads || 0; }
    for (const x of cur.leads) if (x.lead.prov === prov && x.lead.campaign) { const o = m.get(x.lead.campaign) || m.set(x.lead.campaign, { k: x.lead.campaign, sp: 0, clicks: 0, impr: 0, pl: 0, n: 0, s: 0, cv: 0 }).get(x.lead.campaign); o.n++; }
    for (const x of cur.sales) if (x.lead.prov === prov && x.lead.campaign) { const o = m.get(x.lead.campaign); if (o) { o.s++; o.cv += x.cv; } }
    return [...m.values()].sort((a, b) => b.sp - a.sp || b.n - a.n); };
  const chTable = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-sm font-bold' }, 'Channel performance'),
      el('div', { class: 'text-[11px] mt-0.5', style: _mkpMuted }, [bCPL && 'cheapest leads: ' + bCPL.k + ' (' + fmt.usd0(bCPL.sp / bCPL.n) + ')', bCAC && 'lowest CAC: ' + bCAC.k + ' (' + fmt.usd0(bCAC.sp / bCAC.s) + ')', bS && 'most customers: ' + bS.k + ' (' + bS.s + ')', bRev && 'most revenue: ' + bRev.k + ' (' + fmt.usd0(bRev.cv) + ')'].filter(Boolean).join(' · ') || 'Click a channel for its campaigns. ROAS here is contracted ROAS (contract value ÷ spend).')),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Channel', 'ch'), th('Spend', 'ch', 'sp'), th('Leads', 'ch', 'n'), th('CPL', 'ch', 'cpl'), th('Sales', 'ch', 's'), th('Close rate', 'ch', 'close', 'Sales ÷ leads'), th('CAC', 'ch', 'cac'), th('Revenue', 'ch', 'cv', 'Contracted (contract value)'), th('ROAS', 'ch', 'roas', 'Contracted revenue ÷ spend'))),
      el('tbody', {}, ...sortTable(chRows, 'ch').flatMap(r => {
        const isOpen = openCh === r.k, weird = ['Unmapped', 'Unlinked', 'Agency & tools'].includes(r.k);
        const head = el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95', style: { borderColor: 'var(--border)', background: isOpen ? 'rgba(223,100,58,.07)' : '' }, onclick: () => { state._mkpOpenCh = isOpen ? '' : r.k; mountApp(); } },
          td((isOpen ? '▾ ' : '▸ ') + r.k, { fontWeight: '700', color: weird ? MKP_C.amber : undefined }), ...metricCells(r, ghlPaidSet().has(r.k) ? (SP.vendor === 'none' && !MKP_PLATFORM.has(r.k) ? 'unavailable' : '—') : 'organic'));
        if (!isOpen) return [head];
        const cs = campRows(r.k);
        return [head, ...(cs.length ? cs.slice(0, 40).map(c => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', fontSize: '11px' } },
          td('    ' + c.k.slice(0, 60), { paddingLeft: '28px', color: 'var(--text-muted)' }), td(c.sp ? fmt.usd0(c.sp) : '—'), td(c.n ? fmt.int(c.n) : (c.pl ? fmt.int(Math.round(c.pl)) + ' (platform)' : '—'), c.n ? {} : _mkpMuted),
          td(c.n && c.sp ? fmt.usd0(c.sp / c.n) : c.pl && c.sp ? fmt.usd0(c.sp / c.pl) + ' (platform)' : '—', c.n ? {} : _mkpMuted), td(c.n ? fmt.int(c.s) : '—'), td(c.n ? _mkpPct(c.s / c.n) : '—'), td(c.s && c.sp ? fmt.usd0(c.sp / c.s) : '—'), td(c.cv ? fmt.usd0(c.cv) : '—'),
          td(c.clicks ? fmt.int(Math.round(c.clicks)) + ' clicks · ' + (c.impr ? (c.clicks / c.impr * 100).toFixed(1) + '% CTR · ' + fmt.usd(c.sp / c.clicks) + ' CPC' : '') : '', _mkpMuted)))
          : [el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, el('td', { colspan: '9', class: 'px-6 py-2 text-[11px]', style: _mkpMuted }, MKP_PLATFORM.has(r.k) ? 'No campaign rows for this range.' : 'No campaign detail for this channel (spend comes from QuickBooks; leads carry campaigns once the GoHighLevel sync stores them).'))])];
      }),
      el('tr', { style: { borderTop: '2px solid var(--text)' } }, td('Total', { fontWeight: '700' }), ...metricCells({ n: cur.n, s: cur.s, cv: cur.cv, sp: cur.ad, psp: 0, ps: 0 }))))),
    V.unlinkedCur ? el('div', { class: 'px-4 py-2 text-[11px] border-t', style: { borderColor: 'var(--border)', color: MKP_C.amber } }, fmt.usd0(V.unlinkedCur) + ' of QuickBooks lines in this range aren’t linked to a channel — they count in the total as "Unlinked". Link them on the Spend tab.') : null,
    el('div', { class: 'px-4 py-2 text-[10px] border-t', style: { borderColor: 'var(--border)', color: 'var(--text-subtle)' } }, 'Campaign rows show the platform’s own leads (marked "platform") until GoHighLevel leads carry campaign IDs. Ad set / ad level isn’t pulled yet.'));

  // ── 5 · Markets ──
  const mkRows = rowsBy(l => l.market || 'No market', s => s.market || 'Shared / unallocated').sort((a, b) => b.n - a.n);
  const avgClose = cur.n ? cur.s / cur.n : 0;
  const mkTable = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-sm font-bold' }, 'Market performance'),
      el('div', { class: 'text-[11px] mt-0.5', style: _mkpMuted }, 'Leads go to the office whose customers share the lead’s ZIP. Spend goes by each campaign’s office (Spend tab), split by Google’s location report for multi-market campaigns; campaigns with no market and all QuickBooks vendor spend sit in "Shared / unallocated". Click a market to filter the page.')),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Market', 'mk'), th('Spend', 'mk', 'sp'), th('Leads', 'mk', 'n'), th('CPL', 'mk', 'cpl'), th('Sales', 'mk', 's'), th('Close rate', 'mk', 'close'), th('CAC', 'mk', 'cac'), th('Revenue', 'mk', 'cv'), th('ROAS', 'mk', 'roas'))),
      el('tbody', {}, ...sortTable(mkRows, 'mk').map(r => el('tr', { class: 'border-t cursor-pointer transition hover:brightness-95', style: { borderColor: 'var(--border)' }, onclick: () => { if (r.k === 'No market' || r.k.startsWith('Shared')) return; setF({ market: F.market === r.k ? '' : r.k }); } },
        el('td', { class: 'px-3 py-1.5 whitespace-nowrap font-semibold', style: { color: r.k === 'No market' || r.k.startsWith('Shared') ? 'var(--text-muted)' : undefined } }, r.k,
          r.n >= 30 && avgClose && r.s / r.n < avgClose * 0.6 ? el('span', { class: 'ml-1 text-[9px] font-bold', style: { color: MKP_C.red }, title: 'Close rate well below the all-market rate' }, 'LOW CLOSE') : null,
          r.n >= 30 && avgClose && r.s / r.n > avgClose * 1.3 && r.sp ? el('span', { class: 'ml-1 text-[9px] font-bold', style: { color: MKP_C.sage }, title: 'Closes well above the all-market rate — room for more budget' }, 'STRONG') : null),
        ...metricCells(r)))))));

  // ── 6 · Insights ──
  const ins = [];
  const addI = (impact, sev, text) => ins.push({ impact, sev, text });
  for (const r of chRows) {
    if (r.s >= 5 && r.ps >= 5 && r.sp && r.psp) { const c1 = r.sp / r.s, c0 = r.psp / r.ps; const ch = (c1 - c0) / c0; if (ch >= 0.2) addI((c1 - c0) * r.s, 'red', r.k + ' CAC rose ' + Math.round(ch * 100) + '% vs the prior period (' + fmt.usd0(c0) + ' → ' + fmt.usd0(c1) + ', ' + r.s + ' sales).'); else if (ch <= -0.2) addI((c0 - c1) * r.s * 0.5, 'ok', r.k + ' CAC fell ' + Math.round(-ch * 100) + '% (' + fmt.usd0(c0) + ' → ' + fmt.usd0(c1) + ').'); }
    if (r.sp > 500 && r.psp > 0 && r.sp > r.psp * 1.3 && r.s <= r.ps) addI(r.sp - r.psp, 'red', r.k + ' spend is up ' + Math.round((r.sp / r.psp - 1) * 100) + '% (' + fmt.usd0(r.psp) + ' → ' + fmt.usd0(r.sp) + ') with no more sales (' + r.ps + ' → ' + r.s + ').');
    if (r.sp > 300 && r.n >= 15 && r.s === 0 && Date.now() - _mkpMs(R.to) > 14 * 86400000) addI(r.sp, 'red', r.k + ' spent ' + fmt.usd0(r.sp) + ' for ' + r.n + ' leads and no sales.');
  }
  const allCPL = cur.n && cur.ad ? cur.ad / cur.n : null, allCAC = cur.s && cur.ad ? cur.ad / cur.s : null;
  if (allCPL && allCAC) for (const r of chRows) if (r.sp && r.n >= 20 && r.s >= 3 && r.sp / r.n < allCPL * 0.8 && r.sp / r.s > allCAC * 1.2) addI((r.sp / r.s - allCAC) * r.s, 'amber', r.k + ' brings cheaper leads than average (' + fmt.usd0(r.sp / r.n) + ' vs ' + fmt.usd0(allCPL) + ') but costlier customers (' + fmt.usd0(r.sp / r.s) + ' vs ' + fmt.usd0(allCAC) + ' CAC).');
  for (const r of mkRows) if (r.k !== 'No market' && r.n >= 30 && avgClose && r.s / r.n < avgClose * 0.6) addI((avgClose - r.s / r.n) * r.n * (cur.s ? cur.cv / cur.s : 0), 'amber', r.k + ' has strong lead volume (' + r.n + ') but a ' + _mkpPct(r.s / r.n) + ' close rate vs ' + _mkpPct(avgClose) + ' across markets.');
  if (!G.at || Date.now() - Date.parse(G.at) > 3 * 3600000) addI(1e9, 'red', 'GoHighLevel hasn’t refreshed in ' + (G.at ? ago(G.at) : 'a while') + ' — lead counts may be behind.');
  if (SP.vendor === 'none') addI(1e8, 'amber', 'Vendor spend is missing: QuickBooks line detail hasn’t loaded, so spend, CPL and CAC cover Google + Meta only.');
  if (dl && dl.error) addI(1e8, 'amber', 'Daily Google / Meta spend failed to load (' + dl.error + ').');
  const unm = cur.leads.filter(x => x.lead.prov === 'Unmapped').length; if (unm && cur.n && unm / cur.n > 0.05) addI(unm * 10, 'amber', fmt.int(unm) + ' leads (' + _mkpPct(unm / cur.n) + ') have a GoHighLevel source with no channel — map them in Settings → Configurations → GoHighLevel sources.');
  ins.sort((a, b) => b.impact - a.impact);
  const insights = el('div', { class: 'card p-4' },
    el('div', { class: 'text-sm font-bold' }, 'Marketing insights'),
    el('div', { class: 'text-[11px] mb-2', style: _mkpMuted }, 'Computed from the numbers above with fixed thresholds (±20% CAC, ≥5 sales, ≥30 leads per market), ranked by dollars at stake. They flag what moved, not why.'),
    ins.length ? el('div', { class: 'flex flex-col gap-1.5' }, ...ins.slice(0, 6).map(i => el('div', { class: 'flex items-start gap-2 text-xs' },
      el('span', { style: { width: '8px', height: '8px', borderRadius: '50%', marginTop: '5px', flexShrink: '0', background: i.sev === 'red' ? MKP_C.red : i.sev === 'ok' ? MKP_C.sage : MKP_C.amber } }), el('span', {}, i.text))))
      : el('div', { class: 'text-xs', style: _mkpMuted }, 'Nothing crossed a threshold in this range.'));

  // ── 7 · Detail (collapsed) ──
  const details = (title, body) => el('details', { class: 'card overflow-hidden' }, el('summary', { class: 'px-4 py-3 text-sm font-bold cursor-pointer' }, title), el('div', { class: 'px-4 pb-4' }, body));
  const kv = (k, v, note) => el('div', { class: 'flex items-baseline justify-between gap-3 py-1 border-t text-xs', style: { borderColor: 'var(--border)' } }, el('span', { style: _mkpMuted }, k, note ? el('span', { class: 'text-[10px] ml-1', style: { color: 'var(--text-subtle)' } }, note) : null), el('span', { class: 'tabular-nums font-semibold' }, v));
  const custN = new Set(cur.sales.map(x => String(x.sale.customer_id))).size;
  const revenue = details('Revenue and return', el('div', {},
    kv('Contracted revenue', _mkpUsd(cur.cv), 'contract value of the sales'), kv('Annual recurring value', _mkpUsd(cur.acv)), kv('Average contract value', cur.s ? _mkpUsd(cur.cv / cur.s) : '—'),
    kv('Collected revenue', cur.col == null ? 'Data unavailable' : _mkpUsd(cur.col), cur.col == null ? 'arrives with the next FieldRoutes sync' : 'payments on the account since the sale, once per customer'),
    kv('Revenue per acquired customer', custN ? _mkpUsd(cur.cv / custN) : '—', 'contracted'),
    kv('Contracted ROAS', V.hasSpend && cur.ad ? (cur.cv / cur.ad).toFixed(2) + 'x' : '—'), kv('Collected ROAS', V.hasSpend && cur.ad && cur.col != null ? (cur.col / cur.ad).toFixed(2) + 'x' : 'Data unavailable', 'cash so far ÷ spend — grows as customers pay'),
    kv('Cancellation rate', cur.s ? _mkpPct(cur.sales.filter(x => x.cxl).length / cur.s) : '—', 'sold, then cancelled'),
    kv('Lifetime value', 'Not estimated', 'needs a retention curve; left out rather than guessed')));
  const st = {}; for (const x of cur.leads) { const k = x.lead.status || 'open'; st[k] = (st[k] || 0) + 1; }
  const noContact = cur.leads.filter(x => /no contact/i.test(x.lead.stage)).length;
  const quality = details('Lead quality and sales efficiency', el('div', {},
    kv('Sales per 100 leads', cur.n ? (cur.s / cur.n * 100).toFixed(1) : '—'),
    kv('Calls vs forms', hasType ? cur.leads.filter(x => x.lead.type === 'call').length + ' calls · ' + cur.leads.filter(x => x.lead.type === 'form').length + ' forms · ' + cur.leads.filter(x => !x.lead.type).length + ' unknown' : 'Not tracked', 'GoHighLevel only shows it as the current stage'),
    kv('Qualified vs unqualified', 'Not tracked', 'every opportunity counts until GHL sends a qualified flag'),
    kv('GHL status', Object.entries(st).sort((a, b) => b[1] - a[1]).map(([k, v]) => k + ' ' + v).join(' · ') || '—', 'open / won / lost / abandoned'),
    kv('Sitting in "No Contact"', fmt.int(noContact), 'current stage only — not a contact rate'),
    kv('Contact rate / time to first contact', 'Not tracked', 'no call or message events are synced'),
    kv('Median days lead → sale', med(sold.map(x => x.days)) == null ? '—' : med(sold.map(x => x.days)) + 'd')));
  const attribution = details('Attribution', el('div', {},
    kv('Model', F.attr === 'last' ? 'Last touch — the opportunity’s source' : 'First touch — the contact’s original source'),
    kv('Original source kept', 'Yes', 'the contact source is never overwritten; the opportunity source is the latest touch'),
    kv('Leads with a campaign', fmt.int(cur.leads.filter(x => x.lead.campaign).length) + ' of ' + fmt.int(cur.n), 'UTM campaign from GoHighLevel attribution'),
    kv('Unmapped GHL sources', fmt.int(unm)), kv('Repeat opportunities folded in', fmt.int(V.AL.raw - V.AL.leads.length), 'same person within 30 days')));
  const lockedSp = V.spendIn(R.from, R.to).reduce((a, s) => a + s.amt, 0);
  const diag = details('Data diagnostics', el('div', {},
    kv('Leads matched to a FieldRoutes customer', (() => { const m = cur.leads.filter(x => x.customer).length; return fmt.int(m) + ' of ' + fmt.int(cur.n) + ' (' + _mkpPct(cur.n ? m / cur.n : null) + ')'; })(), 'phone or email exists in FieldRoutes'),
    kv('Matched but not an Office Staff sale', fmt.int(cur.leads.filter(x => x.customer && !x.sold).length), 'existing customers, unsold, or sold by another rep type'),
    kv('Spend in range (all kinds)', V.hasSpend ? _mkpUsd(lockedSp) : 'Data unavailable', 'advertising + agency & tools'),
    kv('Platform spend source', SP.platform === 'daily' ? 'Daily (Windsor)' : SP.platform === 'monthly' ? 'Monthly, spread by day' : 'Unavailable'),
    kv('QuickBooks vendor lines', SP.vendor === 'qbo' ? 'Loaded' : 'Unavailable'), kv('Unlinked QuickBooks lines', _mkpUsd(V.unlinkedCur)),
    kv('Spend with no market', _mkpUsd(V.spendIn(R.from, R.to, 'ad').filter(s => !s.market).reduce((a, s) => a + s.amt, 0)))));

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'flex items-end justify-between gap-3 flex-wrap' },
      el('div', {}, el('div', { class: 'text-lg font-bold' }, 'Marketing Pulse · ' + R.label + (F.market ? ' · ' + F.market : '') + (F.ch ? ' · ' + F.ch.slice(2) : '')),
        el('div', { class: 'text-xs', style: _mkpMuted }, 'Office Staff inbound marketing. Leads = GoHighLevel opportunities; sales = Office Staff FieldRoutes sales matched on phone or email; spend = ad platforms + QuickBooks vendors.'))),
    bar, freshStrip, cards, trend, funnel, chTable, mkTable, insights, revenue, quality, attribution, diag);
}
