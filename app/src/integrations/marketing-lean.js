// ┌─ src/integrations/marketing-lean.js ───────────────────────────────────
// │ Marketing → Metrics, cut down to what decides budget (per Isaac, Nov 9 —
// │ "QuickBooks and FieldRoutes new revenue are the most true numbers… GHL is
// │ also a good one… information overload"). One month at a time (opens on the current month):
// │   Spend        = QuickBooks Advertising & Marketing, allocated on the Spend
// │                  tab (spqAllocMonth) — the same dollars the controller books.
// │   New revenue  = FieldRoutes Office Staff new sales (initial booked or
// │                  done, renewals out): count + contract value.
// │   Leads        = GoHighLevel opportunities, deduped (mkpAllLeads).
// │ Derived: cost per lead, CAC (spend ÷ new sales), return (new revenue ÷
// │ spend), close rate (new sales ÷ leads). Two tables — by branch, by channel —
// │ and one chart (spend vs new revenue by month). Nothing is estimated: a
// │ vendor still waiting on its report shows its dollars at the channel level
// │ and sits out of the branch split until the report is uploaded.
// │ Part of the app.js bundle (app/src/bundle.order.js).
// └────────────────────────────────────────────────────────────────────────
const _mklYm = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
const _mklShift = (ym, n) => { const d = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1 + n, 1); return _mklYm(d); };
const _mklLbl = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
const _mklLblS = (ym) => new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)) - 1, 1).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });
// Default month = the CURRENT month (per Isaac, Nov 16: GHL, QuickBooks and new revenue all land close to real time
// now). Replaces Nov 9's last-closed-month default.
function mklState() {
  const F = state._mkl || (state._mkl = {});
  if (!/^\d{4}-\d{2}$/.test(F.ym || '')) F.ym = _mklYm(new Date());
  return F;
}
const _mklUsd = (v) => v == null || !isFinite(v) ? '—' : fmt.usd0(v);
const _mklPct = (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%';
const _mklX = (v) => v == null || !isFinite(v) ? '—' : v.toFixed(2) + 'x';
const _mklNum = (v) => v == null ? '—' : fmt.int(v);
const _mklAgo = (iso) => { if (!iso) return ''; const h = (Date.now() - Date.parse(iso)) / 3600000; return !isFinite(h) ? '' : h < 1 ? Math.max(1, Math.round(h * 60)) + 'm ago' : h < 48 ? Math.round(h) + 'h ago' : Math.round(h / 24) + 'd ago'; };
// FieldRoutes source → the channel name the Spend tab and GoHighLevel use (same rules as GHL labels).
function _mklChannelOfSource(src) {
  if (typeof frChannelOf === 'function') return frChannelOf(src);   // Configurations → FieldRoutes sources → channel
  const s = String(src || '').trim(); if (!s) return 'Unspecified';
  const p = typeof ghlAutoProvider === 'function' ? ghlAutoProvider(s) : '';
  if (p === GHL_NOT_LEAD) return s;   // e.g. Door to Door on an office sale — shown as is, so the mis-source is visible
  return p || s;
}
// One month's truth, by branch and by channel. Memoized per month + data identity.
// cap (optional, per Isaac, Nov 16): a day of the month — only count through that day, so a partial current month
// compares against the same stretch of the compare month (Nov 1–16 vs Oct 1–16). Sales by sold date, leads by lead
// date, QuickBooks spend by charge date; wages & incentives (a monthly figure) are prorated by days.
function mklMonth(ym, cap) {
  cap = cap > 0 ? Math.min(31, Math.floor(cap)) : 0;
  const subs = state.reportingSubscriptions || [];
  const AL = typeof mkpAllLeads === 'function' ? mkpAllLeads() : null;
  const A = typeof spqAllocMonth === 'function' ? spqAllocMonth(ym) : null;
  const dayOf = (d) => Number(String(d || '').slice(8, 10)) || 0;
  const inCap = (d) => !cap || dayOf(d) <= cap;
  const sig = [ym, cap, subs.length, AL ? AL.leads.length : -1, A ? A.total + '|' + Object.keys(A.waiting || {}).length + '|' + JSON.stringify(Object.keys(A.byProv)) : 'noA', typeof frSourceMap === 'function' ? JSON.stringify(frSourceMap()) : ''].join('§');
  const M = state._mklMemo || (state._mklMemo = {});
  const mk = cap ? ym + '@' + cap : ym;
  if (M[mk] && M[mk].sig === sig && M[mk].subs === subs && M[mk].al === AL) return M[mk].v;
  const br = {}, ch = {}, x = {};   // x = office → channel → cell (per Isaac, Nov 16: the grid's cell pop-up breaks an office down by channel and a channel by office)
  const xcell = (b, c) => { const o = x[b] || (x[b] = {}); return cell(o, c); };
  const cell = (o, k) => o[k] || (o[k] = { spend: 0, leads: 0, s: 0, svc: 0, cv: 0, waiting: 0 });
  const TC = (b) => typeof _mktgTC === 'function' ? _mktgTC(b) : String(b || '');
  // Spend (QuickBooks, allocated).
  let spend = null, spendWaiting = 0, spendUnassigned = 0, spendLines = 0;
  if (A) {
    // Capped: the share of the month's QuickBooks dollars charged through the cap day scales every allocation.
    const _capF = (() => { if (!cap) return 1; const L = A.lines.filter(L => L.prov !== SPQ_SKIP); const t = L.reduce((x, y) => x + y.amt, 0); return t > 0 ? L.filter(L => dayOf(L.day) <= cap).reduce((x, y) => x + y.amt, 0) / t : 0; })();
    spend = A.total * _capF; spendUnassigned = (A.unassigned || 0) * _capF; spendLines = A.lines.filter(L => L.prov !== SPQ_SKIP && inCap(L.day)).length;
    for (const p in A.cells) for (const b in A.cells[p]) { cell(br, TC(b)).spend += A.cells[p][b] * _capF; xcell(TC(b), typeof spqLabel === 'function' ? spqLabel(p) : p).spend += A.cells[p][b] * _capF; }
    for (const p in A.byProv) cell(ch, typeof spqLabel === 'function' ? spqLabel(p) : p).spend += A.byProv[p].amt * _capF;
    for (const p in (A.waiting || {})) { const c = cell(ch, p); c.spend += A.waiting[p].amt * _capF; c.waiting += A.waiting[p].amt * _capF; spendWaiting += A.waiting[p].amt * _capF; }
  }
  // New revenue (FieldRoutes): Office Staff, initial booked or done, renewals out, sold this month.
  // A new sale (per Isaac, Nov 16, second pass): a subscription whose initial is PENDING (on the calendar) or
  // SERVICED — the FieldRoutes leaderboard's pending/serviced rule — not a bare card with no appointment. New sales
  // and bookings are one and the same number; revenue is theirs; CAC divides by it.
  const servicedInit = (s) => !!s.initial_serviced_date || String(s.initial_status || '').trim().toLowerCase() === 'completed';
  const booked = (s) => servicedInit(s) || String(s.initial_status || '').trim().toLowerCase() === 'pending';
  const srcClass = (s) => typeof reportingSourceClass === 'function' ? reportingSourceClass(reportingSourceOf(s)) : '';
  const notRen = (s) => srcClass(s) !== 'renewal';
  // ACV = contract value at sale (per Isaac, Nov 16): upsell-sourced sales (add-ons to existing customers) are out.
  const notUpsell = (s) => srcClass(s) !== 'upsell';
  let s = 0, svc = 0, cv = 0; const sales = [];
  for (const r of subs) {
    if (String(r.sold_by_type || '').trim() !== 'Office Staff' || String(r.sold_date || '').slice(0, 7) !== ym || !inCap(r.sold_date) || !booked(r) || !notRen(r) || !notUpsell(r)) continue;
    if (typeof reportingNonSaleService === 'function' && reportingNonSaleService(r.subscription)) continue;
    const v = Number(r.subscription_contract_value) || 0, done = 1; s++; svc += done; cv += v; sales.push(r);   // pending or serviced both count (per Isaac)
    const b = cell(br, TC(r.office_name || 'No branch')); b.s++; b.svc += done; b.cv += v;
    const c = cell(ch, _mklChannelOfSource(reportingSourceOf(r))); c.s++; c.svc += done; c.cv += v;
    const xc = xcell(TC(r.office_name || 'No branch'), _mklChannelOfSource(reportingSourceOf(r))); xc.s++; xc.svc += done; xc.cv += v; xc.sales = xc.sales || []; xc.sales.push(r);
  }
  // Leads (GoHighLevel, deduped).
  let leads = null;
  if (AL) {
    leads = 0;
    for (const l of AL.leads) { if (String(l.d).slice(0, 7) !== ym || !inCap(l.d)) continue; leads++; cell(br, l.market || 'No branch').leads++; cell(ch, l.prov === 'Unmapped' ? 'Unmapped GHL source' : l.prov).leads++; const xl = xcell(l.market || 'No branch', l.prov === 'Unmapped' ? 'Unmapped GHL source' : l.prov); xl.leads++; (xl.leadRows || (xl.leadRows = [])).push(l); }
  }
  // Wages (Spend tab → Wages, per rep per month; per Isaac, Nov 16 — part of CAC), spread to offices by their share
  // of the month's new revenue (mktgWagesMonth); Nov 9's by-office entries still count for months that only have those.
  let labor = 0, wages = 0, incentives = 0, hasLabor = false;
  const _dim = new Date(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0).getDate(), _laborF = cap ? Math.min(1, cap / _dim) : 1;
  try {
    const W = typeof mktgWagesMonth === 'function' ? mktgWagesMonth(ym) : { total: 0, by: {} };
    const I = typeof mktgIncentivesMonth === 'function' ? mktgIncentivesMonth(ym) : { total: 0, by: {} };
    wages = (W.total || 0) * _laborF; incentives = (I.total || 0) * _laborF;
    for (const b of new Set([...Object.keys(W.by), ...Object.keys(I.by)])) { const w = (Number(W.by[b]) || 0) * _laborF, inc = (Number(I.by[b]) || 0) * _laborF, v = w + inc; if (!v) continue; hasLabor = true; labor += v; const c = cell(br, TC(b)); c.labor = (c.labor || 0) + v; c.wages = (c.wages || 0) + w; c.inc = (c.inc || 0) + inc; }
  } catch (e) { /* no store yet */ }
  // Per-sale link to a GoHighLevel lead (per Isaac, Nov 18): the latest opportunity on the account's phone or email on
  // or before the sold date (back to 180 days). A sale with none is "booked without a lead" — a lead that booked under
  // another name / phone / email, or a sale with no opportunity at all. The grid's red reads from this, not from a
  // cell happening to have zero leads. Leads from any month count as the link; only the sale has to be in this month.
  let linked = 0; const unlinked = [];
  if (AL && sales.length) {
    const idx = _mklLeadIndex(AL);
    const p10 = (v) => (typeof _chPhone10 === 'function') ? _chPhone10(v) : String(v || '').replace(/\D/g, '').slice(-10);
    for (const r of sales) {
      const sold = String(r.sold_date || '').slice(0, 10), floor = _mklShiftDay(sold, -180), ceil = _mklShiftDay(sold, 1);
      const cands = [].concat(idx.p.get(p10(r.phone)) || [], idx.e.get(String(r.email || '').trim().toLowerCase()) || []);
      let best = null; for (const l of cands) if (l.d >= floor && l.d <= ceil && (!best || l.d > best.d)) best = l;
      r._mklLead = best || null;
      if (best) linked++; else unlinked.push(r);
      const xc = xcell(TC(r.office_name || 'No branch'), _mklChannelOfSource(reportingSourceOf(r)));
      if (best) xc.linked = (xc.linked || 0) + 1; else (xc.unlinked || (xc.unlinked = [])).push(r);
    }
  }
  const v = { ym, cap, A, spend, spendWaiting, spendUnassigned, spendLines, s, svc, cv, sales, leads, linked: AL ? linked : null, unlinked, br, ch, x, labor, wages, incentives, hasLabor, hasSpend: !!A, hasLeads: !!AL, hasSubs: subs.length > 0 };
  M[mk] = { sig, subs, al: AL, v };
  return v;
}

// Leads by phone / email (every month), built once per lead set.
function _mklLeadIndex(AL) {
  if (_mklLeadIndex._m && _mklLeadIndex._m.src === AL.leads) return _mklLeadIndex._m.idx;
  const p = new Map(), e = new Map();
  for (const l of AL.leads) { if (l.p) (p.get(l.p) || p.set(l.p, []).get(l.p)).push(l); if (l.e) (e.get(l.e) || e.set(l.e, []).get(l.e)).push(l); }
  _mklLeadIndex._m = { src: AL.leads, idx: { p, e } };
  return _mklLeadIndex._m.idx;
}
function _mklShiftDay(iso, days) { const d = new Date((iso || '1970-01-01') + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
// Spend vs new revenue, last 12 months ending at ym — totals only (cheap).
function mklSeries(ym) {
  const out = [];
  for (let i = 11; i >= 0; i--) { const m = _mklShift(ym, -i); const D = mklMonth(m); out.push({ ym: m, spend: D.hasSpend ? D.spend : null, cv: D.hasSubs ? D.cv : null, s: D.s }); }
  return out;
}

function mktgLeanView() { return perfT('lean:view', () => _mktgLeanView()); }
function _mktgLeanView() {
  if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend();
  if (typeof ghlLoadLeads === 'function' && state._ghl === undefined) ghlLoadLeads();
  if (typeof rcEnsureLedger === 'function') rcEnsureLedger();   // RIDDCOIN adds are incentives (per Isaac, Nov 18)
  const F = mklState(); const ym = F.ym;
  // Compare to (per Isaac, Nov 11 — the key-metrics tile look): the previous month, or the same month last year.
  const cmp = F.cmp === 'year' ? 'year' : F.cmp === 'none' ? 'none' : 'prev';   // No change hides the compare line on the tiles (per Isaac, Nov 16)
  const pm = _mklShift(ym, cmp === 'year' ? -12 : -1);
  if (typeof reportingLoadAdSpend === 'function') { reportingLoadAdSpend(Number(ym.slice(0, 4))); if (pm.slice(0, 4) !== ym.slice(0, 4)) reportingLoadAdSpend(Number(pm.slice(0, 4))); const y0 = Number(_mklShift(ym, -11).slice(0, 4)); if (y0 !== Number(ym.slice(0, 4)) && y0 !== Number(pm.slice(0, 4))) reportingLoadAdSpend(y0); }   // the 12-month sparklines
  // Month to date (per Isaac, Nov 16): while the open month is showing, the compare month is cut at today's day of
  // the month — Nov 1–16 vs Oct 1–16 — so the arrows don't read low against a full month. A closed month compares whole.
  const _today = new Date(), _isOpen = ym === _mklYm(_today), _cap = _isOpen ? _today.getDate() : 0;
  const cur = mklMonth(ym), prev = mklMonth(pm, _cap);
  const _mtdLbl = _cap ? ' 1\u2013' + _cap : '';
  const muted = { color: 'var(--text-muted)' };
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const months = []; for (let i = 0; i < 18; i++) months.push(_mklYm(new Date(new Date().getFullYear(), new Date().getMonth() - i, 1)));
  const monthSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: selSt, onchange: (e) => { F.ym = e.target.value; mountApp(); } },
    ...months.map(k => el('option', { value: k, selected: k === ym }, _mklLblS(k) + (k === months[0] ? ' · open' : ''))));
  const goSpend = () => { state._mktSub = 'spend'; state._mktCtrlMonth = ym; mountApp(); };

  // ── Data line: where each number comes from and how fresh it is. ──
  const G = state._ghl, P = state.reportingIsSpendPayee;
  const dot = (ok, label) => el('span', { class: 'inline-flex items-center gap-1.5 text-[11px]', style: muted }, el('span', { class: 'inline-block rounded-full', style: { width: '7px', height: '7px', background: ok ? 'var(--ok)' : '#DC2626' } }), label);
  // ── Tiles: the three truths, then what they make. ──
  // ── Key metrics (per Isaac, Nov 11 — the dashboard-tile look): icon, label, the number, ↑/↓ vs the compare
  // month with its value, and a 12-month sparkline of the metric. Click a tile for its drill where there is one.
  // CAC / cost per job divide by BOOKINGS — initials completed in FieldRoutes (per Isaac, Nov 16), not by sold.
  const cac = (D) => D.hasSpend && D.spend && D.svc ? D.spend / D.svc : null, ret = (D) => D.hasSpend && D.spend ? D.cv / D.spend : null, cpl = (D) => D.hasSpend && D.spend && D.leads ? D.spend / D.leads : null;
  // CAC (per Isaac, Nov 16): (marketing spend + wages + incentives) ÷ new sales, with whatever of the three is in for the
  // month — the note says what's still missing rather than the tile going blank.
  const fcac = (D) => (D.hasSpend || D.hasLabor) && D.svc ? ((D.hasSpend ? D.spend : 0) + D.labor) / D.svc : null, avgC = (D) => D.s ? D.cv / D.s : null, svcOf = (D) => D.hasSubs ? D.svc : null;
  // Close rate = Plaibook's department number for the month (sold ÷ qualified, per Isaac, Nov 11), written hourly by
  // the Cloud Run job to app_settings.close_rates_dept; new sales ÷ GHL leads only until that exists for the month.
  const DEPT = typeof _closeRatesDeptStore === 'function' ? _closeRatesDeptStore() : null;
  const deptOf = (D) => DEPT && DEPT.months && DEPT.months[D.ym] ? DEPT.months[D.ym] : null;
  const close = (D) => { const m = deptOf(D); return m && Number.isFinite(Number(m.rate)) ? Number(m.rate) : D.leads ? D.s / D.leads : null; };
  const closeNote = (() => { const m = deptOf(cur); return m ? 'Plaibook · ' + fmt.int(m.sold) + ' sold of ' + fmt.int(m.qualified) + ' qualified' : DEPT === null || DEPT === undefined ? 'Plaibook loading…' : 'Plaibook has no ' + _mklLblS(ym) + ' yet — new sales ÷ GHL leads shown'; })();
  const spendOf = (D) => D.hasSpend ? D.spend : null, cvOf = (D) => D.hasSubs ? D.cv : null, leadsOf = (D) => D.hasLeads ? D.leads : null, salesOf = (D) => D.hasSubs ? D.s : null;
  const spendNote = !cur.hasSpend ? 'No QuickBooks lines for this month yet' : [cur.spendLines + ' charges', cur.spendUnassigned > 0 ? _mklUsd(cur.spendUnassigned) + ' need a vendor' : '', cur.spendWaiting > 0 ? _mklUsd(cur.spendWaiting) + ' waiting on vendor reports' : ''].filter(Boolean).join(' · ') + ' → Spend tab';
  const MONTHS12 = []; for (let i = 11; i >= 0; i--) MONTHS12.push(_mklShift(ym, -i));
  const series = (fn) => MONTHS12.map(m => { const v = fn(mklMonth(m)); return v == null || !isFinite(v) ? null : v; });
  const spark = (vals, color) => {
    const pts = vals.map((v, i) => [i, v]).filter(x => x[1] != null);
    if (pts.length < 2) return el('div', { style: { height: '34px' } });
    const W = 100, H = 34, min = Math.min(...pts.map(x => x[1])), max = Math.max(...pts.map(x => x[1])), span = max - min || 1;
    const X = (i) => (i / (vals.length - 1)) * W, Y = (v) => H - 3 - ((v - min) / span) * (H - 8);
    const d = pts.map((x, i) => (i ? 'L' : 'M') + X(x[0]).toFixed(1) + ' ' + Y(x[1]).toFixed(1)).join(' ');
    const area = d + ' L' + X(pts[pts.length - 1][0]).toFixed(1) + ' ' + H + ' L' + X(pts[0][0]).toFixed(1) + ' ' + H + ' Z';
    const last = pts[pts.length - 1];
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('preserveAspectRatio', 'none'); svg.style.cssText = 'width:100%;height:34px;display:block;overflow:visible';
    svg.innerHTML = '<path d="' + area + '" fill="' + color + '" fill-opacity=".12"/><path d="' + d + '" fill="none" stroke="' + color + '" stroke-width="1.6" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>'
      + '<circle cx="' + X(last[0]).toFixed(1) + '" cy="' + Y(last[1]).toFixed(1) + '" r="2.2" fill="' + color + '" vector-effect="non-scaling-stroke"/>'
      + '<line x1="0" y1="' + (H - 0.5) + '" x2="' + W + '" y2="' + (H - 0.5) + '" stroke="var(--border-2)" stroke-width="1" vector-effect="non-scaling-stroke"/>';
    return svg;
  };
  // Hover table for a tile's sparkline (per Isaac, Nov 16): one line per month — value, MoM, YoY — instead of the
  // raw number dump. YoY needs the month a year earlier, so the series is read over 24 months.
  const MONTHS24 = []; for (let i = 23; i >= 0; i--) MONTHS24.push(_mklShift(ym, -i));
  const sparkPop = (o, node) => {
    const v24 = MONTHS24.map(m => { const v = o.get(mklMonth(m)); return v == null || !isFinite(v) ? null : v; });
    const pct = (a, b) => a == null || b == null || !b ? null : (a - b) / Math.abs(b);
    const pctEl = (p) => p == null ? el('span', { style: { color: 'var(--text-subtle)' } }, '—') : el('span', { style: { color: o.upGood == null ? 'inherit' : ((p >= 0) === o.upGood ? '#4ADE80' : '#F87171'), fontWeight: '600' } }, (p >= 0 ? '+' : '') + (p * 100).toFixed(1) + '%');
    const pop = el('div', { style: { position: 'absolute', left: '8px', right: '8px', bottom: '100%', marginBottom: '6px', zIndex: '30', background: '#323230', color: '#F4F4EE', borderRadius: '10px', padding: '8px 10px', boxShadow: 'var(--shadow-lg)', fontSize: '11px', display: 'none', pointerEvents: 'none' } },
      el('div', { class: 'font-bold mb-1', style: { fontSize: '10px', letterSpacing: '.06em', textTransform: 'uppercase', color: '#C9C9BE' } }, o.label + ' · last 12 months'),
      el('table', { style: { width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' } },
        el('thead', {}, el('tr', {}, ...['Month', '', 'MoM', 'YoY'].map((h, i) => el('th', { style: { textAlign: i ? 'right' : 'left', fontWeight: '600', color: '#C9C9BE', padding: '0 0 3px', fontSize: '9px', letterSpacing: '.06em', textTransform: 'uppercase' } }, h)))),
        el('tbody', {}, ...MONTHS12.map((m, i) => { const j = i + 12; const v = v24[j]; return el('tr', { style: { borderTop: '1px solid rgba(255,255,255,.08)' } },
          el('td', { style: { padding: '2px 0', color: m === ym ? '#FFFFFF' : '#C9C9BE', fontWeight: m === ym ? '700' : '400', whiteSpace: 'nowrap' } }, _mklLblS(m) + (m === ym && _cap ? ' · to date' : '')),
          el('td', { style: { padding: '2px 0', textAlign: 'right', fontWeight: '600' } }, v == null ? '—' : o.fmt(v)),
          el('td', { style: { padding: '2px 0 2px 10px', textAlign: 'right' } }, pctEl(pct(v, v24[j - 1]))),
          el('td', { style: { padding: '2px 0 2px 10px', textAlign: 'right' } }, pctEl(pct(v, v24[j - 12])))); }))));
    node.style.position = 'relative'; node.style.cursor = 'default';
    node.addEventListener('mouseenter', () => { pop.style.display = 'block'; });
    node.addEventListener('mouseleave', () => { pop.style.display = 'none'; });
    node.append(pop);
    return node;
  };
  const ICON = {
    spend: '<rect x="2" y="6" width="20" height="13" rx="2"/><circle cx="12" cy="12.5" r="3"/><path d="M2 10h2M20 10h2M2 15h2M20 15h2"/>',
    revenue: '<path d="M12 2v20M17 6.5a4 4 0 0 0-4-2.5H11a3.5 3.5 0 0 0 0 7h2a3.5 3.5 0 0 1 0 7h-2a4 4 0 0 1-4-2.5"/>',
    sales: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    leads: '<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0M19 8v6M16 11h6"/>',
    ret: '<path d="M3 17l6-6 4 4 8-8"/><path d="M14 7h7v7"/>',
    cac: '<circle cx="12" cy="12" r="9"/><path d="M12 7v10M9.5 9.5h3.5a1.75 1.75 0 0 1 0 3.5h-2a1.75 1.75 0 0 0 0 3.5H15"/>',
    cpl: '<path d="M20 6H4l8 9z"/><path d="M12 15v6"/>',
    close: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l3 3 5-6"/>',
    avg: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/>',
    fcac: '<path d="M4 20h16M6 20V9l6-5 6 5v11"/><path d="M10 20v-5h4v5"/>',
  };
  const icon = (k) => { const w = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); w.setAttribute('viewBox', '0 0 24 24'); w.setAttribute('fill', 'none'); w.setAttribute('stroke', 'currentColor'); w.setAttribute('stroke-width', '1.8'); w.setAttribute('stroke-linecap', 'round'); w.setAttribute('stroke-linejoin', 'round'); w.style.cssText = 'width:18px;height:18px;flex:none;color:var(--text-subtle)'; w.innerHTML = ICON[k] || ''; return w; };
  const cmpLbl = cmp === 'year' ? 'last year' : 'prior month';
  const tile = (o) => {
    const a = o.get(cur), b = o.get(prev);
    const dv = a != null && b != null && isFinite(a) && isFinite(b) && b !== 0 ? (a - b) / Math.abs(b) : null;
    const good = dv == null ? null : o.upGood == null ? null : (dv >= 0) === o.upGood;
    const col = good == null ? 'var(--text-muted)' : good ? '#16A34A' : '#DC2626';
    const vals = series(o.get);
    const noPrior = b == null || !isFinite(b);
    const cmpLine = el('div', { class: 'flex items-baseline gap-1.5 text-[12px] tabular-nums', style: { color: 'var(--text-muted)' } },
      dv == null ? el('span', {}, noPrior ? '—' : '—') : el('span', { class: 'font-bold', style: { color: col } }, (dv >= 0 ? '↑ +' : '↓ ') + (dv * 100).toFixed(1) + '%'),
      el('span', {}, 'vs. ' + (noPrior ? 'no ' + cmpLbl : o.fmt(b)), el('span', { class: 'ml-1', style: { color: 'var(--text-subtle)' } }, '· ' + _mklLblS(pm) + _mtdLbl)));
    return el('div', { class: 'card p-4 flex flex-col gap-2' + (o.onClick ? ' cursor-pointer' : ''), style: { borderTop: '3px solid ' + (o.color || 'var(--accent)') }, onclick: o.onClick || null },   // no title on the card itself — the browser tooltip sat on top of the sparkline table (per Isaac, Nov 16); the ⓘ carries the tip
      el('div', { class: 'flex items-center justify-between gap-2' },
        el('div', { class: 'text-[12px] font-semibold', style: { color: 'var(--text-muted)' } }, o.label, o.tip ? el('span', { class: 'ml-1 text-[10px]', style: { color: 'var(--text-subtle)' }, title: o.tip }, 'ⓘ') : null),
        icon(o.icon)),
      el('div', { class: 'leading-none font-black tabular-nums', style: { fontFamily: 'ui-monospace, monospace', fontSize: '28px' } }, a == null || !isFinite(a) ? '—' : o.fmt(a),
        // * = a cost input isn't in for this month yet (per Isaac, Nov 16), so the number will move when it is.
        o.star ? el('span', { class: 'ml-1', style: { color: '#B45309', fontSize: '18px', verticalAlign: 'top' }, title: o.star }, '*') : null),
      cmp === 'none' ? null : cmpLine,
      sparkPop(o, el('div', {}, spark(vals, o.color || 'var(--accent)'))),
      o.note ? el('div', { class: 'text-[10px] truncate', style: { color: 'var(--text-subtle)' }, title: o.note }, o.note) : null);
  };
  const cmpSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: selSt, onchange: (e) => { F.cmp = e.target.value; mountApp(); } },
    ...[['none', 'No change'], ['prev', 'MoM change'], ['year', 'YoY change']].map(([v, l]) => el('option', { value: v, selected: v === cmp }, l)));
  // (The old Key metrics bar and Sources line are gone — folded into the header, per Isaac Nov 16.)
  const TEAL = '#2F7F86', EMBER = '#DF643A', INK = 'var(--text)';
  // Two rows of five, full width (per Isaac, Nov 11): what came in, then what it cost.
  // Every grid metric is a tile (per Isaac, Nov 16); click a tile for its drill-down — by office and by channel for
  // the month, each row opening the full cell pop-up. The CAC star / notes stay.
  const drill = (k) => () => mklMetricPop(k, cur, ym, _cap);
  // Share of total spend / of CAC % (per Isaac, Nov 16): on the three cost tiles, what slice of total spend this is
  // and how many points of CAC % it accounts for (its dollars ÷ new revenue).
  const _totSpend = (cur.hasSpend ? cur.spend : 0) + cur.labor;
  const shareNote = (v) => !v || !_totSpend ? '' : Math.round(v / _totSpend * 100) + '% of total spend' + (cur.cv ? ' · ' + (v / cur.cv * 100).toFixed(1) + ' pts of CAC %' : '');
  const TILE_DEFS = [
    ['spend', tile({ label: 'Marketing spend', icon: 'spend', get: spendOf, fmt: _mklUsd, upGood: null, color: INK, tip: 'QuickBooks marketing charges, allocated on the Spend tab', note: [shareNote(cur.hasSpend ? cur.spend : 0), spendNote].filter(Boolean).join(' · '), onClick: drill('spend') })],
    ['cv', tile({ label: 'New revenue', icon: 'revenue', get: cvOf, fmt: _mklUsd, upGood: true, color: EMBER, tip: 'FieldRoutes: Office Staff new sales sold this month with the initial pending or serviced (the leaderboard rule); renewals and upsells out — contract value at sale', note: cur.s + ' new sale' + (cur.s === 1 ? '' : 's') + ' · Office Staff', onClick: drill('cv') })],
    ['s', tile({ label: 'New sales', icon: 'sales', get: salesOf, fmt: _mklNum, upGood: true, color: EMBER, tip: 'New sales with the initial pending or serviced in FieldRoutes — a bare card with no appointment is not a sale', onClick: drill('s') })],
    ['avg', tile({ label: 'ACV', icon: 'avg', get: avgC, fmt: _mklUsd, upGood: true, color: EMBER, tip: 'New revenue ÷ new sales — contract value at sale, no add-ons or upsells', onClick: drill('avg') })],
    ['leads', tile({ label: 'Leads', icon: 'leads', get: leadsOf, fmt: _mklNum, upGood: true, color: TEAL, tip: 'GoHighLevel opportunities, one per person per 30 days', note: cur.hasLeads ? '' : 'GoHighLevel not loaded', onClick: drill('leads') })],
    ['ret', tile({ label: 'ROAS', icon: 'ret', get: ret, fmt: _mklX, upGood: true, color: TEAL, tip: 'New revenue ÷ marketing spend', onClick: drill('ret') })],
    ['mcac', tile({ label: 'Marketing CAC', icon: 'cac', get: cac, fmt: _mklUsd, upGood: false, color: INK, tip: 'Marketing spend ÷ new sales (initial pending or serviced)', onClick: drill('mcac') })],
    ['cac', tile({ label: 'Cost per job', icon: 'fcac', get: fcac, fmt: _mklUsd, upGood: false, color: INK, tip: '(Marketing spend + wages + incentives) ÷ new sales (initial pending or serviced)',
      star: !cur.wages && !cur.incentives ? '* wages and incentives not entered for ' + _mklLblS(ym) + ' yet — marketing spend only' : !cur.wages ? '* wages not entered for ' + _mklLblS(ym) + ' yet' : !cur.incentives ? '* incentives not entered for ' + _mklLblS(ym) + ' yet' : '',
      note: (!cur.wages && !cur.incentives ? '* wages & incentives not in yet' : !cur.wages ? '* wages not in yet' : !cur.incentives ? '* incentives not in yet' : _mklUsd(cur.wages) + ' wages · ' + _mklUsd(cur.incentives) + ' incentives'), onClick: drill('cac') })],
    ['cpl', tile({ label: 'CPL', icon: 'cpl', get: cpl, fmt: _mklUsd, upGood: false, color: TEAL, tip: 'Marketing spend ÷ leads', onClick: drill('cpl') })],
    ['close', tile({ label: 'Close rate', icon: 'close', get: close, fmt: _mklPct, upGood: true, color: TEAL, tip: 'Plaibook — the Inside Sales department\u2019s sold ÷ qualified for the month', note: closeNote, onClick: drill('close') })],
    ['wages', tile({ label: 'Wages', icon: 'fcac', get: (D) => D.hasLabor || D.wages ? D.wages : null, fmt: _mklUsd, upGood: null, color: INK, tip: 'Spend tab → Wages (Inside Sales), spread to offices by share of the month’s new revenue', note: cur.wages ? shareNote(cur.wages) : 'enter on the Spend tab', onClick: drill('wages') })],
    ['inc', tile({ label: 'Incentives', icon: 'avg', get: (D) => D.hasLabor || D.incentives ? D.incentives : null, fmt: _mklUsd, upGood: null, color: INK, tip: 'Spend tab → Incentives, spread to offices by share of the month’s new revenue', note: cur.incentives ? shareNote(cur.incentives) : 'enter on the Spend tab', onClick: drill('inc') })],
    ['tot', tile({ label: 'Total spend', icon: 'spend', get: (D) => D.hasSpend || D.hasLabor ? (D.hasSpend ? D.spend : 0) + D.labor : null, fmt: _mklUsd, upGood: null, color: INK, tip: 'Marketing spend + wages + incentives', note: cur.cv && _totSpend ? (_totSpend / cur.cv * 100).toFixed(1) + '% of new revenue = CAC %' : '', onClick: drill('tot') })],
    ['cacp', tile({ label: 'CAC %', icon: 'cac', get: (D) => D.cv && (D.hasSpend || D.hasLabor) ? ((D.hasSpend ? D.spend : 0) + D.labor) / D.cv : null, fmt: _mklPct, upGood: false, color: INK, tip: 'Total spend ÷ new revenue', onClick: drill('cacp') })],
    ['rpl', tile({ label: 'Revenue per lead', icon: 'leads', get: (D) => D.hasLeads && D.leads ? D.cv / D.leads : null, fmt: _mklUsd, upGood: true, color: TEAL, tip: 'New revenue ÷ leads — what a lead is worth before any cost; next to CPL it is the lead margin', onClick: drill('rpl') })]
  ];
  // Owner-only ordering (per Isaac, Nov 16): the Admin – Owner drags tiles into place; the order is saved in the
  // shared marketing config and is what every other admin sees. New tiles append at the end.
  const _m = _mktgStore(); const saved = Array.isArray(_m.tileOrder) ? _m.tileOrder : [];
  const order = [...saved.filter(k => TILE_DEFS.some(d => d[0] === k)), ...TILE_DEFS.map(d => d[0]).filter(k => !saved.includes(k))];
  const owner = typeof isOwnerUser === 'function' && isOwnerUser();
  const tiles = el('div', { class: 'grid gap-3 mkl-tiles' });
  let dragKey = null;
  for (const k of order) {
    const node = TILE_DEFS.find(d => d[0] === k)[1];
    node.dataset.tile = k;
    if (owner) {
      node.draggable = true; node.style.cursor = 'grab';
      node.addEventListener('dragstart', (e) => { dragKey = k; node.style.opacity = '.5'; try { e.dataTransfer.setData('text/plain', k); e.dataTransfer.effectAllowed = 'move'; } catch (x) { /* ok */ } });
      node.addEventListener('dragend', () => { node.style.opacity = '1'; dragKey = null; });
      node.addEventListener('dragover', (e) => { if (dragKey && dragKey !== k) { e.preventDefault(); node.style.outline = '2px dashed var(--accent)'; } });
      node.addEventListener('dragleave', () => { node.style.outline = ''; });
      node.addEventListener('drop', (e) => { e.preventDefault(); node.style.outline = ''; if (!dragKey || dragKey === k) return;
        const next = order.filter(x => x !== dragKey); next.splice(next.indexOf(k), 0, dragKey);
        _m.tileOrder = next; _mktgSave(); mountApp(); });
    }
    tiles.append(node);
  }

  // ── Tables: by branch, by channel — the same seven columns. ──
  const th = (t, r, extra) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold ' + (r ? 'text-right' : 'text-left'), style: Object.assign({ color: 'var(--text-muted)', background: 'var(--card-2)', whiteSpace: 'nowrap' }, extra || {}) }, t);
  const td = (t, st, r) => el('td', { class: 'px-3 py-1.5 tabular-nums whitespace-nowrap ' + (r ? 'text-right' : ''), style: Object.assign({ fontFamily: 'ui-monospace, monospace' }, st || {}) }, t);
  const row = (name, c, bold, note) => { const _cac = c.s && c.spend ? c.spend / c.s : null, _ret = c.spend ? c.cv / c.spend : null, _cpl = c.leads && c.spend ? c.spend / c.leads : null, _close = c.leads ? c.s / c.leads : null, _lab = c.labor || 0, _fcac = c.s && (c.spend || _lab) ? (c.spend + _lab) / c.s : null;
    return el('tr', { class: 'border-t', style: Object.assign({ borderColor: 'var(--border)' }, bold ? { background: 'var(--card-2)', borderTop: '2px solid var(--text)' } : {}) },
      el('td', { class: 'px-3 py-1.5 whitespace-nowrap', style: { fontWeight: bold ? '800' : '700', fontFamily: 'inherit' } }, name, note ? el('span', { class: 'text-[10px] ml-2 font-normal', style: { color: '#B45309' } }, note) : null),
      td(c.spend ? _mklUsd(c.spend) : '—', c.spend ? null : muted, true), td(c.leads ? _mklNum(c.leads) : '—', c.leads ? null : muted, true), td(c.s ? _mklNum(c.s) : '—', c.s ? null : muted, true), td(c.cv ? _mklUsd(c.cv) : '—', c.cv ? null : muted, true),
      td(_mklPct(_close), _close == null ? muted : null, true), td(_mklUsd(_cpl), _cpl == null ? muted : null, true), td(_mklUsd(_cac), _cac == null ? muted : null, true),
      ...(showLabor ? [td(_lab ? _mklUsd(_lab) : '—', _lab ? null : muted, true), td(_mklUsd(_fcac), _fcac == null ? muted : null, true)] : []),
      td(_mklX(_ret), _ret == null ? muted : { fontWeight: '700', color: _ret >= 1 ? '#3E5A3A' : '#B91C1C' }, true)); };
  let showLabor = false;   // set per table: the branch table shows wages + fully-loaded CAC when any are entered
  const head = () => el('tr', {}, th('', false, { background: 'var(--card-2)' }), th('Spend', true), th('Leads', true), th('New sales', true), th('New revenue', true), th('Close rate', true), th('Cost / lead', true), th('Marketing CAC', true), ...(showLabor ? [th('Wages', true), th('CAC', true)] : []), th('Return', true));
  const sumOf = (o, keys) => keys.reduce((t, k) => { const c = o[k]; t.spend += c.spend; t.leads += c.leads; t.s += c.s; t.cv += c.cv; t.labor += c.labor || 0; return t; }, { spend: 0, leads: 0, s: 0, cv: 0, labor: 0 });
  const table = (title, sub, o, extraRows, noteOf, withLabor) => {
    showLabor = !!withLabor && Object.values(o).some(c => c.labor);
    const keys = Object.keys(o).filter(k => o[k].spend || o[k].leads || o[k].s || o[k].labor).sort((a, b) => (o[b].spend - o[a].spend) || (o[b].cv - o[a].cv) || (o[b].leads - o[a].leads));
    const tot = sumOf(o, keys);
    return el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-5 py-3' }, el('h3', { class: 'text-base font-bold' }, title), el('div', { class: 'text-[11px] mt-0.5', style: muted }, sub)),
      el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, head()),
        el('tbody', {}, ...keys.map(k => row(k, o[k], false, noteOf ? noteOf(k, o[k]) : null)), ...(extraRows || []), keys.length ? row('Total', tot, true) : null))),
      !keys.length ? el('div', { class: 'px-5 py-4 text-sm text-center', style: muted }, 'Nothing for ' + _mklLbl(ym) + ' yet.') : null);
  };
  // Branch: spend placed on the Spend tab; waiting vendors are out of this split until their report lands.
  const brTable = table('By branch · ' + _mklLblS(ym), 'Spend as allocated on the Spend tab' + (cur.spendWaiting > 0 ? ' — ' + _mklUsd(cur.spendWaiting) + ' of vendor spend is not in any branch yet (waiting on reports), so branch CAC runs low until it lands' : '') + '. Leads by the lead’s ZIP; new sales by the account’s office.' + (cur.hasLabor ? ' Wages & incentives from the Spend tab; CAC · loaded = (spend + wages) ÷ new sales.' : ''), cur.br, null, null, true);
  const chTable = table('By channel · ' + _mklLblS(ym), 'Spend by vendor from QuickBooks; leads by GoHighLevel source; new sales by the FieldRoutes source on the account (last touch). Close rate = new sales ÷ leads, so a channel whose GHL label and FieldRoutes source don\u2019t line up will read high or low — map them the same in Configurations.', cur.ch, null,
    (k, c) => c.waiting > 0 ? 'waiting on its report — not in branches yet' : k === 'Unmapped GHL source' ? 'map these in Configurations → GoHighLevel sources' : k === 'Unspecified' ? 'no source on the account — fix in FieldRoutes' : (c.s && !c.leads) ? 'sales but no leads — no GoHighLevel label maps here (Configurations → sources)' : (c.leads && !c.s && !c.spend) ? 'leads but no sales — no FieldRoutes source maps here' : null);

  // ── Chart: spend vs new revenue, last 12 months. ──
  // The chart follows the grid's year (per Isaac, Nov 16): Jan–Dec of the year shown; months after the picked one are
  // left empty rather than drawn as $0.
  const _gy = Number(ym.slice(0, 4));
  const S = (() => { const out = []; for (let i = 0; i < 12; i++) { const m = _gy + '-' + String(i + 1).padStart(2, '0'); if (m > ym) { out.push({ ym: m, spend: null, cv: null, s: 0 }); continue; } const D = mklMonth(m); out.push({ ym: m, spend: D.hasSpend ? D.spend : null, cv: D.hasSubs ? D.cv : null, s: D.s }); } return out; })(), idC = 'mklTrend';
  setTimeout(() => {
    if (typeof Chart === 'undefined') return; const c = document.getElementById(idC); if (!c) return;
    const reg = typeof _chartInstances !== 'undefined' ? _chartInstances : (window._mklCharts = window._mklCharts || {});
    if (reg[idC]) { reg[idC].destroy(); delete reg[idC]; }
    const ink = state.theme === 'dark' ? '#E6E6DC' : '#323230', txt = state.theme === 'dark' ? '#C9C9BE' : '#555', grid = state.theme === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    reg[idC] = new Chart(c.getContext('2d'), { data: { labels: S.map(x => _mklLblS(x.ym)), datasets: [
        { type: 'bar', label: 'Marketing spend (QuickBooks)', data: S.map(x => x.spend), backgroundColor: ink, borderRadius: 2, order: 2 },
        { type: 'line', label: 'New revenue (FieldRoutes)', data: S.map(x => x.cv), borderColor: '#DF643A', backgroundColor: '#DF643A', borderWidth: 2.4, pointRadius: 3, tension: 0.3, spanGaps: true, order: 1 }] },
      options: { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } }, tooltip: { callbacks: { label: (x) => ' ' + x.dataset.label + ': ' + (x.parsed.y == null ? '—' : fmt.usd0(x.parsed.y)), afterBody: (items) => { const x = S[items[0].dataIndex]; return x && x.spend && x.cv != null ? ['Return ' + (x.cv / x.spend).toFixed(2) + 'x · CAC ' + (x.s ? fmt.usd0(x.spend / x.s) : '—')] : []; } } } },
        scales: { x: { grid: { display: false }, ticks: { color: txt, font: { size: 10 }, maxRotation: 0 } }, y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => fmt.usd0(v) } } } } });
  }, 40);
  const chart = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3' }, el('h3', { class: 'text-base font-bold', title: 'Bars are QuickBooks marketing spend by charge month; the line is Office Staff new-sale contract value by sale month. A month with no QuickBooks lines shows no bar, not $0.' }, 'Spend vs new revenue · ' + _gy)),
    el('div', { class: 'p-3', style: { height: '190px' } }, el('canvas', { id: idC })));

  // One header (per Isaac, Nov 16): title + compare note on the left; Previous month / Last year beside the month
  // picker on the right. The Sources line and the Key metrics bar are folded in here.
  const ownerHint = (typeof isOwnerUser === 'function' && isOwnerUser()) ? el('span', { class: 'text-[11px]', style: muted }, 'Drag tiles to reorder', Array.isArray(_mktgStore().tileOrder) && _mktgStore().tileOrder.length ? el('button', { class: 'ml-2 font-semibold underline', style: { color: 'var(--accent)' }, onclick: () => { delete _mktgStore().tileOrder; _mktgSave(); mountApp(); } }, 'Reset') : null) : null;
  const srcTip = 'Sources · QuickBooks marketing' + (P && P.pulledAt ? ' ' + _mklAgo(P.pulledAt) : cur.hasSpend ? '' : ' (no lines for ' + _mklLblS(ym) + ')') + ' · FieldRoutes new sales' + (state.reportingSubscriptions ? '' : ' (loading)') + ' · GoHighLevel leads' + (G && G.at ? ' ' + _mklAgo(G.at) : ' (loading)');
  // Header controls ride on the Marketing sub-tab bar (per Isaac, Nov 16) — see mklHeaderControls(); no header card here.
  void ownerHint; void cmpSel; void monthSel; void srcTip;
  // ── The one grid (per Isaac, Nov 16): rows = offices (or channels), Jan–Dec + YTD, one metric at a time — the
  // old Marketing P&L table with every metric in its dropdown. Replaces the two single-month tables and the P&L tab.
  const grid = mklYearGrid(ym);
  void brTable; void chTable;
  // Channels × offices grid + traffic by hour (marketing-dash.js) sit between the tiles and the year grid (per Isaac, Nov 18).
  const dash = typeof mktgDashBlocks === 'function' ? (() => { try { return mktgDashBlocks(ym); } catch (e) { console.warn('[marketing] dash blocks', e); return []; } })() : [];
  return el('div', { class: 'flex flex-col gap-4' }, chart, tiles, ...dash, grid);   // chart above the tiles; the header card is gone — its controls sit on the sub-tab bar (per Isaac, Nov 16)
}
// The month's new sales behind the New revenue tile (same rows the table counts).
function mklOpenSales(D, title) {
  if (typeof openReportingDrillModal !== 'function') return;
  openReportingDrillModal({ chartTitle: title, sliceLabel: D.s + ' new sale' + (D.s === 1 ? '' : 's') + ' · ' + fmt.usd0(D.cv) + ' contracted', rows: D.sales, formatValue: fmt.usd0 });
}


// ── Year grid (per Isaac, Nov 16): offices (or channels) × Jan–Dec + YTD, metric picker. ──
// Cells read mklMonth(ym).br / .ch, so every number here is the same one the tiles and the Spend tab show; ratios
// in the YTD column are recomputed from the summed dollars, never averaged.
const MKL_GRID_METRICS = [
  { k: 'cv',    label: 'New revenue',     fmt: (v) => fmt.usd0(v),  get: (c) => c.cv,                                              tip: 'FieldRoutes Office Staff new sales — contract value, by sold month' },
  { k: 's',     label: 'New sales',       fmt: (v) => fmt.int(v),   get: (c) => c.s,                                               tip: 'New sales — initial pending or serviced in FieldRoutes, the leaderboard rule (the same thing as a booking)' },
  { k: 'avg',   label: 'ACV',             fmt: (v) => fmt.usd0(v),  get: (c) => c.s ? c.cv / c.s : null,                           tip: 'New revenue ÷ new sales — contract value at sale, no add-ons or upsells' },
  { k: 'leads', label: 'Leads',       fmt: (v) => fmt.int(v),   get: (c) => c.leads,                                           tip: 'GoHighLevel opportunities, one per person per 30 days' },
  { k: 'close', label: 'Close rate',      fmt: (v) => (v * 100).toFixed(1) + '%', get: (c) => c.leads ? c.s / c.leads : null,     tip: 'New sales ÷ new leads' },
  { k: 'spend', label: 'Marketing spend', fmt: (v) => fmt.usd0(v),  get: (c) => c.spend,                                           tip: 'QuickBooks Advertising & Marketing, as allocated on the Spend tab' },
  { k: 'wages', label: 'Wages',           fmt: (v) => fmt.usd0(v),  get: (c) => c.wages || 0,                                      tip: 'Spend tab → Wages, spread to offices by share of the month’s new revenue' },
  { k: 'inc',   label: 'Incentives',      fmt: (v) => fmt.usd0(v),  get: (c) => c.inc || 0,                                        tip: 'Spend tab → Incentives, spread to offices by share of the month’s new revenue' },
  { k: 'tot',   label: 'Total spend',     fmt: (v) => fmt.usd0(v),  get: (c) => c.spend + (c.labor || 0),                          tip: 'Marketing spend + wages + incentives' },
  { k: 'cpl',   label: 'CPL',             fmt: (v) => fmt.usd0(v),  get: (c) => c.leads && c.spend ? c.spend / c.leads : null,     tip: 'Marketing spend ÷ leads' },
  { k: 'mcac',  label: 'Marketing CAC',   fmt: (v) => fmt.usd0(v),  get: (c) => c.svc && c.spend ? c.spend / c.svc : null,         tip: 'Marketing spend ÷ new sales (initial pending or serviced)' },
  { k: 'cac',   label: 'Cost per job',    fmt: (v) => fmt.usd0(v),  get: (c) => c.svc && (c.spend || c.labor) ? (c.spend + (c.labor || 0)) / c.svc : null, tip: '(Marketing spend + wages + incentives) ÷ new sales (initial pending or serviced)' },
  { k: 'cacp',  label: 'CAC %',           fmt: (v) => (v * 100).toFixed(0) + '%', get: (c) => c.cv ? (c.spend + (c.labor || 0)) / c.cv : null, tip: 'Total spend ÷ new revenue' },
  { k: 'ret',   label: 'ROAS',            fmt: (v) => v.toFixed(2) + 'x', get: (c) => c.spend ? c.cv / c.spend : null,             tip: 'New revenue ÷ marketing spend' },
  { k: 'rpl',   label: 'Revenue per lead', fmt: (v) => fmt.usd0(v),  get: (c) => c.leads ? c.cv / c.leads : null,                 tip: 'New revenue ÷ leads — what a lead is worth before any cost' },
];
function mklYearGrid(ym) {
  const year = Number(ym.slice(0, 4)), curMi = Number(ym.slice(5, 7)) - 1;
  const by = state._mklGridBy === 'ch' ? 'ch' : 'br';
  const M = MKL_GRID_METRICS.find(x => x.k === state._mklGridMetric) || MKL_GRID_METRICS[0];
  const months = []; for (let i = 0; i < 12; i++) months.push(mklMonth(year + '-' + String(i + 1).padStart(2, '0')));
  // Change view (per Isaac, Nov 16): No change · MoM change · YoY change — the same cells as % against the month
  // before (Jan reads against last December) or the same month a year earlier; YTD compares year to date to the
  // same stretch of last year.
  // The grid follows the change dropdown on the Metrics/Spend bar (per Isaac, Nov 16) — one control for tiles and grid.
  const _cmpF = mklState().cmp; const chg = _cmpF === 'year' ? 'yoy' : _cmpF === 'none' ? 'none' : 'mom';
  const prevMonths = chg === 'none' ? null : (() => { const o = []; for (let i = 0; i < 12; i++) o.push(mklMonth((year - 1) + '-' + String(i + 1).padStart(2, '0'))); return o; })();
  const zero = () => ({ spend: 0, leads: 0, s: 0, svc: 0, cv: 0, labor: 0, wages: 0, inc: 0 });
  const add = (t, c) => { t.spend += c.spend || 0; t.leads += c.leads || 0; t.s += c.s || 0; t.svc += c.svc || 0; t.cv += c.cv || 0; t.labor += c.labor || 0; t.wages += c.wages || 0; t.inc += c.inc || 0; return t; };
  const keys = [...new Set(months.flatMap(D => Object.keys(D[by] || {})))].filter(k => !/^(Unspecified|Unmapped GHL source|No branch)$/.test(k));
  const cellOf = (k, i) => (months[i][by] || {})[k] || zero();
  const pcellOf = (k, i) => prevMonths ? ((prevMonths[i][by] || {})[k] || zero()) : zero();
  const ytdOf = (k) => { const t = zero(); for (let i = 0; i < 12; i++) if (months[i].ym <= ym) add(t, cellOf(k, i)); return t; };
  const pytdOf = (k) => { const t = zero(); for (let i = 0; i < 12; i++) if (months[i].ym <= ym) add(t, pcellOf(k, i)); return t; };
  keys.sort((a, b) => (ytdOf(b).cv - ytdOf(a).cv) || (ytdOf(b).spend - ytdOf(a).spend));
  const totOf = (i) => keys.reduce((t, k) => add(t, cellOf(k, i)), zero());
  const ptotOf = (i) => keys.reduce((t, k) => add(t, pcellOf(k, i)), zero());
  const totYtd = () => { const t = zero(); for (let i = 0; i < 12; i++) if (months[i].ym <= ym) add(t, totOf(i)); return t; };
  const ptotYtd = () => { const t = zero(); for (let i = 0; i < 12; i++) if (months[i].ym <= ym) add(t, ptotOf(i)); return t; };
  // The cell a change compares against: MoM = the month before (Jan → last Dec), YoY = same month last year.
  const baseOf = (getCur, getPrev, i) => chg === 'yoy' ? getPrev(i) : i > 0 ? getCur(i - 1) : getPrev(11);
  const UP_GOOD = { cv: true, s: true, avg: true, leads: true, close: true, spend: null, wages: null, inc: null, tot: null, cpl: false, mcac: false, cac: false, cacp: false, ret: true, rpl: true };
  const muted = { color: 'var(--text-muted)' };
  const th = (t, r, extra) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (r ? 'text-right' : 'text-left'), style: Object.assign({ color: 'var(--text-muted)', background: 'var(--card-2)', position: 'sticky', top: 0 }, extra || {}) }, t);
  const show = (c) => { const v = M.get(c); return v == null || !isFinite(v) ? '—' : M.fmt(v); };
  const td = (c, bold, future, base, pop) => {
    const cellEl = _td(c, bold, future, base);
    if (pop && !future) { cellEl.classList.add('cursor-pointer', 'hover:underline'); cellEl.title = 'Click for every metric here'; cellEl.onclick = (e) => { e.stopPropagation(); mklCellPop(pop); }; }
    return cellEl;
  };
  const _td = (c, bold, future, base) => {
    if (chg !== 'none') {
      const a = M.get(c), b = base ? M.get(base) : null;
      const p = a == null || b == null || !isFinite(a) || !isFinite(b) || !b || future ? null : (a - b) / Math.abs(b);
      const good = p == null || UP_GOOD[M.k] == null ? null : (p >= 0) === UP_GOOD[M.k];
      return el('td', { class: 'px-3 py-1.5 text-right tabular-nums whitespace-nowrap', style: Object.assign({ fontFamily: 'ui-monospace, monospace' }, p == null ? muted : { color: good == null ? 'var(--text)' : good ? '#16A34A' : '#DC2626' }, bold ? { fontWeight: '700' } : {}) }, p == null ? '—' : (p >= 0 ? '+' : '') + (p * 100).toFixed(1) + '%');
    }
    const t = show(c); return el('td', { class: 'px-3 py-1.5 text-right tabular-nums whitespace-nowrap', style: Object.assign({ fontFamily: 'ui-monospace, monospace' }, t === '—' || future ? muted : {}, bold ? { fontWeight: '700' } : {}) }, t); };
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const sticky = (bg) => ({ position: 'sticky', left: 0, background: bg, zIndex: 1, boxShadow: '1px 0 0 var(--border)' });
  const rowOf = (k) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
    el('td', { class: 'px-3 py-1.5 whitespace-nowrap font-semibold', style: sticky('var(--card)') }, k),
    ...MON.map((_, i) => td(cellOf(k, i), i === curMi, months[i].ym > ym, baseOf((j) => cellOf(k, j), (j) => pcellOf(k, j), i), { by, key: k, ym: months[i].ym, cell: cellOf(k, i), D: months[i] })), td(ytdOf(k), true, false, chg === 'yoy' ? pytdOf(k) : null, { by, key: k, ym: null, cell: ytdOf(k), months: months.filter(D => D.ym <= ym) }));
  const totRow = el('tr', { style: { borderTop: '2px solid var(--text)', background: 'var(--card-2)' } },
    el('td', { class: 'px-3 py-1.5 whitespace-nowrap font-black', style: sticky('var(--card-2)') }, 'RIDD'),
    ...MON.map((_, i) => td(totOf(i), true, months[i].ym > ym, baseOf(totOf, ptotOf, i), { by, key: null, ym: months[i].ym, cell: totOf(i), D: months[i] })), td(totYtd(), true, false, chg === 'yoy' ? ptotYtd() : null, { by, key: null, ym: null, cell: totYtd(), months: months.filter(D => D.ym <= ym) }));
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const metricSel = el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: selSt, onchange: (e) => { state._mklGridMetric = e.target.value; mountApp(); } },
    ...MKL_GRID_METRICS.map(x => el('option', { value: x.k, selected: x.k === M.k }, x.label)));
  const byBtn = (v, l) => el('button', { class: 'px-2.5 py-1 text-[11px] font-bold', style: by === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => { state._mklGridBy = v; mountApp(); } }, l);
  const bySel = el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } }, byBtn('br', 'By office'), byBtn('ch', 'By channel'));
  const chgLbl = chg === 'mom' ? ' · MoM change' : chg === 'yoy' ? ' · YoY change' : '';
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-center gap-3 flex-wrap' },
      el('h3', { class: 'text-base font-bold', title: M.tip + '. YTD runs through ' + _mklLblS(ym) + '; ratios in YTD come from the summed dollars.' + (chg === 'mom' ? ' MoM: against the month before (Jan against last December); YTD has no MoM.' : chg === 'yoy' ? ' YoY: against the same month last year; YTD against the same stretch of last year.' : '') }, M.label + ' · ' + year + chgLbl),
      el('span', { class: 'ml-auto' }), bySel, metricSel),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th(by === 'br' ? 'Office' : 'Channel', false, { position: 'sticky', left: 0, zIndex: 2 }), ...MON.map((m, i) => th(m, true, i === curMi ? { color: 'var(--accent)' } : null)), th('YTD', true))),
      el('tbody', {}, ...keys.map(rowOf), totRow))),
    !keys.length ? el('div', { class: 'px-5 py-4 text-sm text-center', style: muted }, 'Nothing for ' + year + ' yet.') : null);
}

// One cell's pop-up (per Isaac, Nov 16): every metric for that office (or channel) in that month or YTD, then the
// same office broken down by channel — or the channel by office. Click outside or Esc to close.
function mklCellPop(p) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const muted = { color: 'var(--text-muted)' };
  const who = p.key == null ? 'RIDD' : p.key, when = p.ym ? _mklLbl(p.ym) : 'YTD';
  const otherLbl = p.by === 'br' ? 'By channel' : 'By office';
  // Breakdown by the other dimension, summed over the months in play.
  const Ds = p.ym ? [p.D] : (p.months || []);
  const agg = {};
  const addTo = (k, c) => { const t = agg[k] || (agg[k] = { spend: 0, leads: 0, s: 0, cv: 0 }); t.spend += c.spend || 0; t.leads += c.leads || 0; t.s += c.s || 0; t.cv += c.cv || 0; };
  for (const D of Ds) {
    const X = D.x || {};
    if (p.by === 'br') { const offs = p.key == null ? Object.keys(X) : [p.key]; for (const o of offs) for (const c in (X[o] || {})) addTo(c, X[o][c]); }
    else { for (const o in X) { if (p.key == null) { for (const c in X[o]) addTo(o, X[o][c]); } else if (X[o][p.key]) addTo(o, X[o][p.key]); } }
  }
  const rows = Object.entries(agg).filter(([, c]) => c.spend || c.leads || c.s).sort((a, b) => (b[1].cv - a[1].cv) || (b[1].spend - a[1].spend));
  const th = (t, r) => el('th', { class: 'px-3 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (r ? 'text-right' : 'text-left'), style: Object.assign({ background: 'var(--card-2)' }, muted) }, t);
  const td = (t, r, st) => el('td', { class: 'px-3 py-1 whitespace-nowrap' + (r ? ' text-right tabular-nums' : ''), style: Object.assign({ fontFamily: r ? 'ui-monospace, monospace' : 'inherit' }, st || {}) }, t);
  const val = (M, c) => { const v = M.get(c); return v == null || !isFinite(v) ? '—' : M.fmt(v); };
  const metricsEl = el('div', { class: 'grid gap-x-6 gap-y-1', style: { gridTemplateColumns: 'repeat(2, minmax(0, 1fr))' } },
    ...MKL_GRID_METRICS.map(M => el('div', { class: 'flex items-baseline justify-between gap-3 border-b', style: { borderColor: 'var(--border)', padding: '3px 0' }, title: M.tip },
      el('span', { class: 'text-[11px]', style: muted }, M.label), el('span', { class: 'text-sm font-bold tabular-nums', style: { fontFamily: 'ui-monospace, monospace' } }, val(M, p.cell)))));
  const salesOf = (k) => { const out = []; for (const D of Ds) { const X = D.x || {}; if (p.by === 'br') { const offs = p.key == null ? Object.keys(X) : [p.key]; for (const o of offs) if (X[o] && X[o][k] && X[o][k].sales) out.push(...X[o][k].sales); } else { for (const o in X) { if (p.key == null) { for (const c in X[o]) if (o === k && X[o][c].sales) out.push(...X[o][c].sales); } else if (o === k && X[o][p.key] && X[o][p.key].sales) out.push(...X[o][p.key].sales); } } } return out; };
  const brk = rows.length ? el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
    el('thead', {}, el('tr', {}, th(otherLbl.replace('By ', '')), th('Spend', true), th('Leads', true), th('Sales', true), th('Revenue', true), th('CPL', true), th('Mkt CAC', true), th('ROAS', true))),
    el('tbody', {}, ...rows.map(([k, c]) => { const sl = salesOf(k); return el('tr', { class: 'border-t' + (sl.length ? ' cursor-pointer hover:brightness-95' : ''), style: { borderColor: 'var(--border)' }, title: sl.length ? 'Click for the accounts' : '', onclick: sl.length ? () => openReportingDrillModal({ chartTitle: who + ' · ' + k + ' · ' + when, sliceLabel: sl.length + ' new sale' + (sl.length === 1 ? '' : 's') + ' · ' + fmt.usd0(c.cv), rows: sl, formatValue: fmt.usd0 }) : null },
      td(k, false, { fontWeight: '700' }), td(c.spend ? fmt.usd0(c.spend) : '—', true), td(c.leads ? fmt.int(c.leads) : '—', true), td(c.s ? fmt.int(c.s) : '—', true), td(c.cv ? fmt.usd0(c.cv) : '—', true),
      td(c.spend && c.leads ? fmt.usd0(c.spend / c.leads) : '—', true), td(c.spend && c.s ? fmt.usd0(c.spend / c.s) : '—', true), td(c.spend ? (c.cv / c.spend).toFixed(2) + 'x' : '—', true, c.spend ? { fontWeight: '700', color: c.cv / c.spend >= 1 ? '#3E5A3A' : '#B91C1C' } : {})); })))
    : el('div', { class: 'text-[11px] py-2', style: muted }, 'Nothing to break down here.');
  const card = el('div', { class: 'card', style: { width: 'min(820px, calc(100vw - 32px))', maxHeight: '86vh', overflow: 'auto', margin: '6vh auto 0' }, onclick: (e) => e.stopPropagation() },
    el('div', { class: 'px-5 py-3 border-b flex items-start gap-3', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, who + ' · ' + when), el('div', { class: 'text-[11px] mt-0.5', style: muted }, p.key == null ? 'Every office' : (p.by === 'br' ? 'Office' : 'Channel') + ' · every metric, then ' + otherLbl.toLowerCase())),
      el('button', { class: 'ml-auto text-2xl leading-none', style: muted, 'aria-label': 'Close', onclick: close }, '×')),
    el('div', { class: 'px-5 py-3' }, metricsEl),
    el('div', { class: 'px-5 pt-2 pb-1 text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, otherLbl + (p.ym ? '' : ' · YTD')),
    el('div', { class: 'scroll-x px-2 pb-3' }, brk));
  overlay.append(card); document.body.append(overlay);
}

// A tile's drill-down (per Isaac, Nov 16): the metric for the month by office and by channel side by side; each row
// opens the cell pop-up (every metric + the other breakdown). Sales rows are one click further from there.
function mklMetricPop(k, D, ym, cap) {
  const M = MKL_GRID_METRICS.find(x => x.k === k) || MKL_GRID_METRICS[0];
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const muted = { color: 'var(--text-muted)' };
  const when = _mklLbl(ym) + (cap ? ' to date' : '');
  const val = (c) => { const v = M.get(c); return v == null || !isFinite(v) ? '—' : M.fmt(v); };
  const th = (t, r) => el('th', { class: 'px-3 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (r ? 'text-right' : 'text-left'), style: Object.assign({ background: 'var(--card-2)' }, muted) }, t);
  const td = (t, r, st) => el('td', { class: 'px-3 py-1 whitespace-nowrap' + (r ? ' text-right tabular-nums' : ''), style: Object.assign({ fontFamily: r ? 'ui-monospace, monospace' : 'inherit' }, st || {}) }, t);
  const tableOf = (by, o, label) => {
    const keys = Object.keys(o || {}).filter(x => !/^(Unspecified|Unmapped GHL source|No branch)$/.test(x) && (o[x].spend || o[x].leads || o[x].s || o[x].labor)).sort((a, b) => { const va = M.get(o[a]), vb = M.get(o[b]); return (vb == null ? -Infinity : vb) - (va == null ? -Infinity : va); });
    const tot = keys.reduce((t, x) => { const c = o[x]; t.spend += c.spend || 0; t.leads += c.leads || 0; t.s += c.s || 0; t.cv += c.cv || 0; t.labor += c.labor || 0; t.wages += c.wages || 0; t.inc += c.inc || 0; return t; }, { spend: 0, leads: 0, s: 0, cv: 0, labor: 0, wages: 0, inc: 0 });
    const row = (x, c, total) => el('tr', { class: 'border-t' + (total ? '' : ' cursor-pointer hover:brightness-95'), style: Object.assign({ borderColor: 'var(--border)' }, total ? { background: 'var(--card-2)', borderTop: '2px solid var(--text)', fontWeight: '800' } : {}), title: total ? '' : 'Click for every metric for ' + x,
        onclick: total ? null : () => mklCellPop({ by, key: x, ym, cell: c, D }) },
      td(x, false, { fontWeight: total ? '800' : '700' }), td(val(c), true, { fontWeight: '700' }), td(c.spend ? fmt.usd0(c.spend) : '—', true), td(c.leads ? fmt.int(c.leads) : '—', true), td(c.s ? fmt.int(c.s) : '—', true), td(c.cv ? fmt.usd0(c.cv) : '—', true));
    return el('div', { class: 'min-w-0' },
      el('div', { class: 'px-1 pb-1 text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, label),
      keys.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
        el('thead', {}, el('tr', {}, th(label.replace('By ', '')), th(M.label, true), th('Spend', true), th('Leads', true), th('Sales', true), th('Revenue', true))),
        el('tbody', {}, ...keys.map(x => row(x, o[x], false)), row('RIDD', tot, true)))) : el('div', { class: 'text-[11px] py-2 px-1', style: muted }, 'Nothing for ' + when + '.'));
  };
  const big = (() => { const c = { spend: D.hasSpend ? D.spend : 0, leads: D.leads || 0, s: D.s, svc: D.svc, cv: D.cv, labor: D.labor, wages: D.wages, inc: D.incentives }; return val(c); })();
  const card = el('div', { class: 'card', style: { width: 'min(1100px, calc(100vw - 32px))', maxHeight: '86vh', overflow: 'auto', margin: '6vh auto 0' }, onclick: (e) => e.stopPropagation() },
    el('div', { class: 'px-5 py-3 border-b flex items-start gap-3', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, M.label + ' · ' + when), el('div', { class: 'text-[11px] mt-0.5', style: muted }, M.tip)),
      el('div', { class: 'ml-auto text-2xl font-black tabular-nums', style: { fontFamily: 'ui-monospace, monospace' } }, big),
      el('button', { class: 'text-2xl leading-none', style: muted, 'aria-label': 'Close', onclick: close }, '×')),
    el('div', { class: 'p-4 grid gap-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))' } }, tableOf('br', D.br, 'By office'), tableOf('ch', D.ch, 'By channel')),
    /^(spend|wages|inc|tot)$/.test(k) ? el('div', { class: 'px-5 pb-3 text-[11px]' }, el('button', { class: 'font-semibold underline', style: { color: 'var(--accent)' }, onclick: () => { close(); state._mktSub = 'spend'; state._mktCtrlMonth = ym; mountApp(); } }, 'Open the Spend tab →')) : null);
  overlay.append(card); document.body.append(overlay);
}

// The Metrics controls for the Marketing sub-tab bar (per Isaac, Nov 16): owner's drag hint + Reset, the compare
// dropdown, the month picker.
function mklHeaderControls(monthOnly) {
  const F = mklState(); const ym = F.ym, cmp = F.cmp === 'year' ? 'year' : F.cmp === 'none' ? 'none' : 'prev';
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };
  const months = []; for (let i = 0; i < 18; i++) months.push(_mklYm(new Date(new Date().getFullYear(), new Date().getMonth() - i, 1)));
  const monthSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: selSt, onchange: (e) => { F.ym = e.target.value; mountApp(); } },
    ...months.map(k => el('option', { value: k, selected: k === ym }, _mklLblS(k) + (k === months[0] ? ' · open' : ''))));
  const cmpSel = el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: selSt, onchange: (e) => { F.cmp = e.target.value; mountApp(); } },
    ...[['none', 'No change'], ['prev', 'MoM change'], ['year', 'YoY change']].map(([v, l]) => el('option', { value: v, selected: v === cmp }, l)));
  const m = _mktgStore();
  const ownerHint = (typeof isOwnerUser === 'function' && isOwnerUser()) ? el('span', { class: 'text-[11px]', style: { color: 'var(--text-muted)' } }, 'Drag tiles to reorder', Array.isArray(m.tileOrder) && m.tileOrder.length ? el('button', { class: 'ml-2 font-semibold underline', style: { color: 'var(--accent)' }, onclick: () => { delete m.tileOrder; _mktgSave(); mountApp(); } }, 'Reset') : null) : null;
  return (monthOnly ? [monthSel] : [ownerHint, cmpSel, monthSel]).filter(Boolean);   // Dashboard shows just the month (per Isaac, Nov 18)
}
