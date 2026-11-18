// ┌─ Marketing · LTV / CAC ──────────────────────────────────────────────────
// │ Customer lifetime value against what it costs to win one (per Isaac,
// │ Nov 18 2026) — the tile that replaced Revenue per lead on Marketing →
// │ Dashboard, and its drill-down.
// │
// │ Data: reporting/marketing/ltv.json, written nightly by the server job
// │ ltv-cohorts (server/services/marketing). One block per group — all of
// │ RIDD, each office, Office Staff vs everyone else, office × seller, and
// │ FieldRoutes source — each a set of start-month cohorts with customers,
// │ ACV, collected revenue by month since start and survivors by month.
// │ The browser does the modelling here, so the method can change without a
// │ job deploy:
// │   · per-customer revenue in month k, pooled over the cohorts old enough
// │     to have lived month k (weighted by customers);
// │   · the population's own curve is used while enough customers back a
// │     month (LTV_MIN_N); after that the all-RIDD curve, scaled by how the
// │     population's first months compare to RIDD's — so young Inside Sales
// │     cohorts project along the mature company curve at their own level;
// │   · LTV(h) = those months summed to the horizon (36 by default); margin-
// │     adjusted when a gross margin % is set on the drill (owner setting).
// │ CAC comes from the dashboard's own month cell (fully loaded cost per job
// │ when wages/incentives are in, marketing CAC otherwise), so LTV / CAC on
// │ the tile divides the same CAC the Cost-per-job tile shows.
// │ Population: Office Staff sales (seller:office) — the marketing
// │ dashboard's department — by office through office_seller:<id>|office.
// └─────────────────────────────────────────────────────────────────────────
const LTV_MIN_N = 150;      // customers needed behind a month for a population's own number to count
const LTV_HORIZONS = [12, 24, 36];

let _ltvCheckedAt = 0;
async function refreshLtvFromCloud(force) {
  if (DEMO || !state.profile || !isAdminRole(state.profile?.role)) return;
  if (!force && Date.now() - _ltvCheckedAt < 300000) return;
  _ltvCheckedAt = Date.now();
  try {
    const r = await _downloadSnapshotBlob('marketing/ltv.json', null, { meta: true }).catch(() => null);
    if (!r || !r.blob) { state._ltvMissing = true; return; }
    const payload = JSON.parse(await r.blob.text());
    if (!payload || !payload.groups) return;
    state._ltv = payload; state._ltvMissing = false; ltvCurve._m = null;
    if (state.view === 'reporting' && state.reportingSubTab === 'marketing') mountApp();
  } catch (e) { state._ltvMissing = true; }
}

// Pooled per-customer curve for one group id ('seller:office', 'office_seller:10|office', 'source:Facebook', 'all:all').
// Returns null when the group is absent. { m[k] $ per customer in month k, cum[k], r[k] retained share, nAt[k]
// customers behind month k, n (customers in the trailing 12 cohorts), acv (ACV of those), aliveNow }.
function ltvCurve(gid, opts) {
  const L = state._ltv; if (!L || !L.groups || !L.groups[gid]) return null;
  const o = opts || {}; const K = (L.maxK || 47) + 1;
  const cache = ltvCurve._m || (ltvCurve._m = new Map()); const ck = gid + '|' + (o.since || '') + '|' + (o.until || '');
  if (cache.has(ck)) return cache.get(ck);
  const G = L.groups[gid];
  const yms = Object.keys(G.cohorts).filter(ym => (!o.since || ym >= o.since) && (!o.until || ym <= o.until)).sort();
  const m = new Array(K).fill(null), r = new Array(K).fill(null), nAt = new Array(K).fill(0);
  for (let k = 0; k < K; k++) {
    let n = 0, rev = 0, alive = 0;
    for (const ym of yms) { const c = G.cohorts[ym]; if (c.age > k && c.n) { n += c.n; rev += Number(c.rev[k]) || 0; alive += Number(c.alive[k]) || 0; } }
    nAt[k] = n; if (n) { m[k] = rev / n; r[k] = alive / n; }
  }
  const cum = []; let acc = 0; for (let k = 0; k < K; k++) { acc += m[k] || 0; cum.push(m[k] == null ? null : acc); }
  // Trailing-12-cohort size and ACV (the customers this LTV is being quoted for).
  const recent = yms.slice(-12); let n12 = 0, cv12 = 0, aliveNow = 0, nAll = 0;
  for (const ym of yms) { const c = G.cohorts[ym]; nAll += c.n; aliveNow += c.aliveNow || 0; }
  for (const ym of recent) { const c = G.cohorts[ym]; n12 += c.n; cv12 += (c.acv || 0) * c.n; }
  const out = { gid, m, cum, r, nAt, n: n12, nAll, aliveNow, acv: n12 ? cv12 / n12 : null, cohorts: yms.length, first: yms[0] || null, last: yms[yms.length - 1] || null };
  cache.set(ck, out); return out;
}

// The model: the population's own months while LTV_MIN_N customers back them, then the reference curve scaled.
function ltvModel(gid, opts) {
  const o = opts || {}; const L = state._ltv; if (!L) return null;
  const g = ltvCurve(gid, o), ref = ltvCurve(o.ref || 'all:all', o.refOpts) || g; if (!g || !ref) return null;
  const K = g.m.length, h = Math.min(K, o.horizon || 36), margin = o.margin > 0 && o.margin <= 100 ? o.margin / 100 : null;
  let K0 = 0; while (K0 < K && g.nAt[K0] >= LTV_MIN_N && g.m[K0] != null) K0++;
  // Scale the reference by the population's own early months (first 12 it has), by ACV when it has fewer than 3.
  const span = Math.min(K0, 12); let scale = 1;
  if (span >= 3) { let a = 0, b = 0; for (let k = 0; k < span; k++) { a += g.m[k]; b += ref.m[k] || 0; } scale = b > 0 ? a / b : 1; }
  else if (g.acv && ref.acv) scale = g.acv / ref.acv;
  const mh = [], rh = [], src = []; let refEnd = 0; while (refEnd < K && ref.m[refEnd] != null) refEnd++;
  for (let k = 0; k < K; k++) {
    if (k < K0) { mh.push(g.m[k]); rh.push(g.r[k]); src.push('own'); }
    else if (k < refEnd) { mh.push((ref.m[k] || 0) * scale); rh.push(ref.r[k]); src.push('ref'); }
    else { mh.push(null); rh.push(null); src.push('none'); }
  }
  const cum = []; let acc = 0; for (let k = 0; k < K; k++) { if (mh[k] == null) { cum.push(null); continue; } acc += mh[k]; cum.push(acc); }
  const at = (hh) => { const v = cum[Math.min(hh, K) - 1]; return v == null ? null : margin ? v * margin : v; };
  const ltv = at(h), rev = cum[Math.min(h, K) - 1];
  return { gid, g, ref, K0, scale, horizon: h, margin, mh, rh, cum, src, ltv, ltvRevenue: rev, ltv12: at(12), ltv24: at(24), ltv36: at(36), observedTo: K0, refEnd, ret12: rh[11], ret24: rh[23], ret36: rh[35], n: g.n, nAll: g.nAll, acv: g.acv, covered: refEnd >= h,
    payback: (cac) => { if (!(cac > 0)) return null; for (let k = 0; k < K; k++) { const v = cum[k]; if (v == null) return null; if ((margin ? v * margin : v) >= cac) return k + 1; } return null; } };
}

// Settings on the shared marketing config: gross margin % and horizon (owner-set, everyone sees).
function _ltvCfg() { const m = typeof _mktgStore === 'function' ? _mktgStore() : {}; return m.ltv || (m.ltv = {}); }
function ltvHorizon() { const h = Number(_ltvCfg().horizon); return LTV_HORIZONS.includes(h) ? h : 36; }
function ltvMargin() { const v = Number(_ltvCfg().margin); return v > 0 && v <= 100 ? v : null; }

// Office name → the office_seller group id (the payload carries office names from the FieldRoutes roster).
function _ltvOfficeGid(name, seller) {
  const L = state._ltv; if (!L) return null; const nm = String(name || '').trim().toLowerCase();
  const id = Object.keys(L.officeNames || {}).find(k => String(L.officeNames[k]).trim().toLowerCase() === nm);
  return id ? (seller ? 'office_seller:' + id + '|' + seller : 'office:' + id) : null;
}

// The tile's CAC for a month cell: fully loaded cost per job when wages / incentives are in, marketing CAC otherwise.
function ltvCacOf(D) { if (!D || !D.svc) return null; const spend = D.hasSpend ? D.spend : 0, labor = D.hasLabor ? D.labor : 0; return (spend || labor) ? (spend + labor) / D.svc : null; }
function ltvCacLabel(D) { return D && D.hasLabor && D.labor ? 'cost per job (spend + wages + incentives)' : 'marketing CAC (spend only — wages not in yet)'; }

// The dashboard tile's number for a month cell: LTV (Office Staff population) ÷ that month's CAC.
function ltvTileValue(D) {
  const M = ltvModel('seller:office', { horizon: ltvHorizon(), margin: ltvMargin() }); const cac = ltvCacOf(D);
  return M && M.ltv && cac ? M.ltv / cac : null;
}
function ltvTileNote(D) {
  if (!state._ltv) return state._ltvMissing ? 'LTV file not published yet — run the ltv-cohorts job' : 'loading LTV cohorts…';
  const M = ltvModel('seller:office', { horizon: ltvHorizon(), margin: ltvMargin() }); const cac = ltvCacOf(D);
  if (!M || !M.ltv) return 'no Office Staff cohorts yet';
  return 'LTV ' + fmt.usd0(M.ltv) + (M.margin ? ' at ' + Math.round(M.margin * 100) + '% margin' : '') + ' · ' + M.horizon + ' mo' + (cac ? ' · CAC ' + fmt.usd0(cac) : ' · CAC not in');
}

// Admin "build now": kicks the server job and reloads the file when it finishes (a minute or two — BigQuery over every payment).
async function _ltvKick(btn) {
  if (DEMO) { toast('Demo mode — nothing to build', 'warn'); return; }
  const orig = btn.textContent; btn.textContent = 'Building… (1–2 min)'; btn.disabled = true;
  try {
    const headers = typeof _apiAuthHeaders === 'function' ? await _apiAuthHeaders({ 'Content-Type': 'application/json' }) : { 'Content-Type': 'application/json' };
    const r = await fetch('/api/jobs/ltv-cohorts', { method: 'POST', headers, body: '{}' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) throw new Error((j && (j.message || j.error)) || ('HTTP ' + r.status));
    toast('LTV cohorts rebuilt — ' + fmt.int((j.summary || {}).customers || 0) + ' customers', 'success');
    await refreshLtvFromCloud(true); mountApp();
  } catch (e) { toast('Could not build: ' + (e && e.message || e), 'error'); }
  btn.textContent = orig; btn.disabled = false;
}

// ── Drill-down ─────────────────────────────────────────────────────────────
function mklLtvPop(D, ym, cap) {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); for (const id of Object.keys(_ltvCharts)) { try { _ltvCharts[id].destroy(); } catch (e) { /* ok */ } delete _ltvCharts[id]; } };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const muted = { color: 'var(--text-muted)' }, mono = { fontFamily: 'ui-monospace, monospace' };
  const owner = typeof isOwnerUser === 'function' && isOwnerUser();
  const L = state._ltv;
  const rerender = () => { close(); mklLtvPop(D, ym, cap); };
  if (!L) {
    overlay.append(el('div', { class: 'card p-6', style: { width: 'min(560px, calc(100vw - 32px))', margin: '12vh auto 0' }, onclick: (e) => e.stopPropagation() },
      el('h3', { class: 'text-base font-bold mb-2' }, 'LTV / CAC'),
      el('p', { class: 'text-sm', style: muted }, state._ltvMissing ? 'The LTV cohort file has not been published yet. It is written nightly by the ltv-cohorts job on the server; build it now or wait for tonight’s run.' : 'Loading the LTV cohorts…'),
      el('div', { class: 'mt-4 flex justify-end gap-2' },
        state._ltvMissing ? el('button', { class: 'px-3 py-1.5 rounded-lg text-[12px] font-semibold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: (ev) => _ltvKick(ev.currentTarget).then(() => { if (state._ltv) { close(); mklLtvPop(D, ym, cap); } }) }, 'Build now') : null,
        el('button', { class: 'px-3 py-1.5 rounded-lg border text-[12px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: close }, 'Close'))));
    document.body.append(overlay); return overlay;
  }
  const H = ltvHorizon(), MG = ltvMargin();
  const pop = state._ltvPop || 'seller:office';   // 'seller:office' (Inside Sales) or 'all:all' (all of RIDD)
  const M = ltvModel(pop, { horizon: H, margin: MG });
  const cac = ltvCacOf(D), cacL = ltvCacLabel(D);
  // Trailing-3-month and year-to-date CAC so a thin month does not decide the ratio alone.
  const monthsBack = (n) => { const out = []; for (let i = 0; i < n; i++) out.push(_mklShift(ym, -i)); return out; };
  const cacOver = (ms) => { let spend = 0, labor = 0, svc = 0, any = false; for (const m of ms) { const X = mklMonth(m); if (!X.svc) continue; if (X.hasSpend || X.hasLabor) { any = true; spend += X.hasSpend ? X.spend : 0; labor += X.hasLabor ? X.labor : 0; svc += X.svc; } } return any && svc ? (spend + labor) / svc : null; };
  const cac3 = cacOver(monthsBack(3)), cacY = cacOver((() => { const out = []; const y = ym.slice(0, 4); let m = ym; while (m.slice(0, 4) === y) { out.push(m); m = _mklShift(m, -1); } return out; })());
  const ratio = M && M.ltv && cac ? M.ltv / cac : null;
  const when = _mklLbl(ym) + (cap ? ' to date' : '');
  const usd = (v) => v == null || !isFinite(v) ? '—' : fmt.usd0(v), pct = (v) => v == null ? '—' : Math.round(v * 100) + '%', x = (v) => v == null || !isFinite(v) ? '—' : v.toFixed(1) + 'x';
  const tilde = (M2, hh) => M2 && M2.observedTo < hh ? '~' : '';
  const ratioColor = (v) => v == null ? 'var(--text)' : v >= 3 ? '#16A34A' : v >= 2 ? '#B45309' : '#DC2626';

  // ── Header stats ──
  const stat = (label, value, sub, color) => el('div', { class: 'rounded-xl border p-3 min-w-0', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: muted }, label),
    el('div', { class: 'text-xl font-black tabular-nums mt-0.5', style: Object.assign({}, mono, color ? { color } : {}) }, value),
    sub ? el('div', { class: 'text-[11px] mt-0.5', style: muted }, sub) : null);
  const sel = (val, opts, on) => el('select', { class: 'rounded-lg border px-2 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => on(e.target.value) }, ...opts.map(([v, l]) => el('option', { value: v, selected: String(v) === String(val) }, l)));
  const controls = el('div', { class: 'flex items-center gap-2 flex-wrap' },
    sel(pop, [['seller:office', 'Inside Sales customers'], ['all:all', 'All RIDD customers']], (v) => { state._ltvPop = v; rerender(); }),
    sel(H, LTV_HORIZONS.map(h => [h, h + '-month LTV']), (v) => { if (!owner) { toast('Only the owner changes the horizon', 'warn'); return; } _ltvCfg().horizon = Number(v); _mktgSave(); rerender(); }),
    el('label', { class: 'flex items-center gap-1 text-[11px]', style: muted, title: 'Gross margin % applied to collected revenue — leave blank for revenue LTV. Owner setting; everyone sees it.' }, 'Margin',
      el('input', { type: 'number', min: '0', max: '100', step: '1', placeholder: '—', value: MG == null ? '' : MG, disabled: !owner, class: 'rounded-lg border px-2 py-1 text-[11px] tabular-nums', style: { width: '58px', borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
        onchange: (e) => { const v = Number(e.target.value); _ltvCfg().margin = v > 0 && v <= 100 ? v : null; _mktgSave(); rerender(); } }), '%'));
  const header = el('div', { class: 'px-5 py-3 border-b flex items-start gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'min-w-0' }, el('h3', { class: 'text-base font-bold' }, 'LTV / CAC · ' + when),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, (M ? M.horizon + '-month lifetime value per new customer' + (MG ? ' at ' + MG + '% gross margin' : ' (collected revenue)') : 'LTV') + ' ÷ ' + cacL + '. Cohorts as of ' + fmt.dateShort(String(L.asOf || '').slice(0, 10)) + '.')),
    el('div', { class: 'ml-auto flex items-center gap-3' }, controls, el('div', { class: 'text-2xl font-black tabular-nums', style: Object.assign({}, mono, { color: ratioColor(ratio) }) }, x(ratio)),
      el('button', { class: 'text-2xl leading-none', style: muted, 'aria-label': 'Close', onclick: close }, '×')));
  const stats = el('div', { class: 'grid gap-3 px-4 pt-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    stat('LTV · ' + (M ? M.horizon : H) + ' mo', M ? tilde(M, M.horizon) + usd(M.ltv) : '—', M ? (M.observedTo >= M.horizon ? 'all observed' : M.observedTo + ' months observed, rest projected on the RIDD curve ×' + M.scale.toFixed(2)) : ''),
    stat('CAC · ' + _mklLblS(ym), usd(cac), cacL.split(' (')[0] + (cac3 ? ' · 3-mo ' + usd(cac3) : '') + (cacY ? ' · YTD ' + usd(cacY) : '')),
    stat('LTV / CAC', x(ratio), cac3 && M && M.ltv ? '3-mo CAC: ' + x(M.ltv / cac3) + (cacY ? ' · YTD: ' + x(M.ltv / cacY) : '') : 'needs this month’s spend', ratioColor(ratio)),
    stat('Payback', M && M.payback(cac) != null ? M.payback(cac) + ' mo' : '—', 'months of collected revenue to cover CAC'),
    stat('Retained · 12 mo', M ? pct(M.ret12) : '—', M ? '24 mo ' + pct(M.ret24) + ' · 36 mo ' + pct(M.ret36) : ''),
    stat('ACV · last 12 cohorts', M ? usd(M.acv) : '—', M ? fmt.int(M.n) + ' new customers · ' + fmt.int(M.nAll) + ' since ' + (M.g.first || '') : ''));

  // ── Charts: $ per customer (observed vs projected) and % retained ──
  const idA = 'ltvCum', idB = 'ltvRet';
  const charts = el('div', { class: 'grid gap-3 px-4 pt-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' } },
    el('div', { class: 'rounded-xl border p-3', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, 'Collected revenue per customer · cumulative'), el('div', { style: { height: '200px' } }, el('canvas', { id: idA }))),
    el('div', { class: 'rounded-xl border p-3', style: { borderColor: 'var(--border)' } }, el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, 'Customers still active · by month since start'), el('div', { style: { height: '200px' } }, el('canvas', { id: idB }))));
  setTimeout(() => {
    if (typeof Chart === 'undefined' || !M) return;
    const txt = state.theme === 'dark' ? '#C9C9BE' : '#555', grid = state.theme === 'dark' ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.06)';
    const K = Math.min(M.mh.length, 48), labels = []; for (let k = 0; k < K; k++) labels.push(String(k + 1));
    const own = M.cum.map((v, k) => k < M.K0 ? v : null), proj = M.cum.map((v, k) => k >= M.K0 - 1 && k < M.refEnd ? v : null);
    const refCum = M.ref.cum.slice(0, K);
    const mk = (id, cfg) => { const c = document.getElementById(id); if (!c) return; if (_ltvCharts[id]) _ltvCharts[id].destroy(); _ltvCharts[id] = new Chart(c.getContext('2d'), cfg); };
    const common = { responsive: true, maintainAspectRatio: false, interaction: { mode: 'index', intersect: false }, plugins: { legend: { position: 'bottom', labels: { color: txt, boxWidth: 10, font: { size: 10 } } } }, scales: { x: { grid: { display: false }, ticks: { color: txt, font: { size: 10 }, maxRotation: 0, callback: (v, i) => (i + 1) % 6 === 0 || i === 0 ? labels[i] : '' }, title: { display: true, text: 'month since start', color: txt, font: { size: 10 } } } } };
    mk(idA, { type: 'line', data: { labels, datasets: [
      { label: 'Observed', data: own.slice(0, K), borderColor: '#DF643A', backgroundColor: '#DF643A', borderWidth: 2.4, pointRadius: 0, tension: .2 },
      { label: 'Projected (RIDD curve ×' + M.scale.toFixed(2) + ')', data: proj.slice(0, K), borderColor: '#DF643A', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .2 },
      { label: 'All RIDD', data: refCum, borderColor: txt, borderWidth: 1.4, pointRadius: 0, tension: .2 },
      ...(cac ? [{ label: 'CAC ' + fmt.usd0(cac), data: labels.map(() => cac), borderColor: '#2F7F86', borderWidth: 1.2, borderDash: [2, 3], pointRadius: 0 }] : [])] },
      options: Object.assign({}, common, { plugins: Object.assign({}, common.plugins, { tooltip: { callbacks: { title: (it) => 'Month ' + labels[it[0].dataIndex], label: (c) => ' ' + c.dataset.label + ': ' + (c.parsed.y == null ? '—' : fmt.usd0(c.parsed.y)) } } }), scales: Object.assign({}, common.scales, { y: { beginAtZero: true, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => fmt.usd0(v) } } }) }) });
    const ownR = M.rh.map((v, k) => k < M.K0 ? v * 100 : null), refR = M.ref.r.slice(0, K).map(v => v == null ? null : v * 100), projR = M.rh.map((v, k) => k >= M.K0 - 1 && v != null ? v * 100 : null);
    mk(idB, { type: 'line', data: { labels, datasets: [
      { label: 'Observed', data: ownR.slice(0, K), borderColor: '#DF643A', borderWidth: 2.4, pointRadius: 0, tension: .2 },
      { label: 'Projected', data: projR.slice(0, K), borderColor: '#DF643A', borderDash: [5, 4], borderWidth: 2, pointRadius: 0, tension: .2 },
      { label: 'All RIDD', data: refR, borderColor: txt, borderWidth: 1.4, pointRadius: 0, tension: .2 }] },
      options: Object.assign({}, common, { plugins: Object.assign({}, common.plugins, { tooltip: { callbacks: { title: (it) => 'Month ' + labels[it[0].dataIndex], label: (c) => ' ' + c.dataset.label + ': ' + (c.parsed.y == null ? '—' : Math.round(c.parsed.y) + '%') } } }), scales: Object.assign({}, common.scales, { y: { min: 0, max: 100, grid: { color: grid }, ticks: { color: txt, font: { size: 10 }, callback: (v) => v + '%' } } }) }) });
  }, 40);

  // ── Tables ──
  const th = (t, r) => el('th', { class: 'px-3 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (r ? 'text-right' : 'text-left'), style: Object.assign({ background: 'var(--card-2)' }, muted) }, t);
  const td = (t, r, st) => el('td', { class: 'px-3 py-1 whitespace-nowrap' + (r ? ' text-right tabular-nums' : ''), style: Object.assign(r ? mono : {}, st || {}) }, t);
  const section = (title, hint, node) => el('div', { class: 'min-w-0' }, el('div', { class: 'px-1 pb-1 text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, title), hint ? el('div', { class: 'px-1 pb-2 text-[11px]', style: muted }, hint) : null, node);
  const empty = (t) => el('div', { class: 'text-[11px] py-2 px-1', style: muted }, t);

  // By office: the office's own Inside Sales (or all) cohorts against the office's CAC this month.
  const offRows = Object.keys(D.br || {}).filter(o => !/^(Unspecified|No branch)$/.test(o)).map(o => {
    const gid = _ltvOfficeGid(o, pop === 'all:all' ? null : 'office'); const refGid = _ltvOfficeGid(o, null);
    const Mo = gid ? ltvModel(gid, { horizon: H, margin: MG, ref: refGid && ltvCurve(refGid) && ltvCurve(refGid).nAll >= 2000 ? refGid : 'all:all' }) : null;
    const c = D.br[o], cacO = ltvCacOf(c);
    return { o, Mo, cacO, ratio: Mo && Mo.ltv && cacO ? Mo.ltv / cacO : null, c };
  }).filter(r => r.Mo || r.c.s || r.c.spend).sort((a, b) => (b.ratio == null ? -1 : b.ratio) - (a.ratio == null ? -1 : a.ratio));
  const officeTable = offRows.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
    el('thead', {}, el('tr', {}, th('Office'), th('New cust · 12 mo', true), th('ACV', true), th('Retained 12 mo', true), th('LTV 12', true), th('LTV 24', true), th('LTV ' + H, true), th('CAC · ' + _mklLblS(ym), true), th('LTV / CAC', true), th('Payback', true))),
    el('tbody', {}, ...offRows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      td(r.o, false, { fontWeight: '700' }), td(r.Mo ? fmt.int(r.Mo.n) : '—', true), td(r.Mo ? usd(r.Mo.acv) : '—', true), td(r.Mo ? pct(r.Mo.ret12) : '—', true),
      td(r.Mo ? tilde(r.Mo, 12) + usd(r.Mo.ltv12) : '—', true), td(r.Mo ? tilde(r.Mo, 24) + usd(r.Mo.ltv24) : '—', true), td(r.Mo ? tilde(r.Mo, H) + usd(r.Mo.ltv) : '—', true, { fontWeight: '700' }),
      td(usd(r.cacO), true), td(x(r.ratio), true, { fontWeight: '800', color: ratioColor(r.ratio) }), td(r.Mo && r.Mo.payback(r.cacO) != null ? r.Mo.payback(r.cacO) + ' mo' : '—', true))),
      (() => { const t = D; const Mt = M; const c = ltvCacOf(t); return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: 'var(--card-2)', borderTop: '2px solid var(--text)', fontWeight: '800' } },
        td('RIDD', false, { fontWeight: '800' }), td(Mt ? fmt.int(Mt.n) : '—', true), td(Mt ? usd(Mt.acv) : '—', true), td(Mt ? pct(Mt.ret12) : '—', true), td(Mt ? tilde(Mt, 12) + usd(Mt.ltv12) : '—', true), td(Mt ? tilde(Mt, 24) + usd(Mt.ltv24) : '—', true), td(Mt ? tilde(Mt, H) + usd(Mt.ltv) : '—', true), td(usd(c), true), td(x(ratio), true, { color: ratioColor(ratio) }), td(Mt && Mt.payback(c) != null ? Mt.payback(c) + ' mo' : '—', true)); })()))) : empty('No office cells for ' + when + '.');

  // By start cohort (quarters) — observed only, no projection: what each wave of customers has actually paid so far.
  const G = L.groups[pop]; const qRows = [];
  if (G) {
    const byQ = {};
    for (const [ymk, c] of Object.entries(G.cohorts)) { const q = ymk.slice(0, 4) + ' Q' + (Math.floor((Number(ymk.slice(5, 7)) - 1) / 3) + 1); const b = byQ[q] || (byQ[q] = { n: 0, cv: 0, aliveNow: 0, rev: new Array(48).fill(0), alive: new Array(48).fill(0), nAt: new Array(48).fill(0), age: 0 }); b.n += c.n; b.cv += (c.acv || 0) * c.n; b.aliveNow += c.aliveNow || 0; b.age = Math.max(b.age, c.age); for (let k = 0; k < 48; k++) if (c.age > k) { b.rev[k] += Number(c.rev[k]) || 0; b.alive[k] += Number(c.alive[k]) || 0; b.nAt[k] += c.n; } }
    const per = (b, hh) => { if (b.nAt[hh - 1] < 1) return null; let s = 0; for (let k = 0; k < hh; k++) s += b.rev[k]; return s / b.nAt[hh - 1]; };   // only cohorts old enough for the whole horizon count
    const ret = (b, hh) => b.nAt[hh - 1] ? b.alive[hh - 1] / b.nAt[hh - 1] : null;
    for (const q of Object.keys(byQ).sort().reverse().slice(0, 12)) { const b = byQ[q]; qRows.push([q, b.n, b.n ? b.cv / b.n : null, b.aliveNow / (b.n || 1), per(b, 6), per(b, 12), ret(b, 12), per(b, 24), ret(b, 24), per(b, 36), ret(b, 36)]); }
  }
  const cohortTable = qRows.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
    el('thead', {}, el('tr', {}, th('Start quarter'), th('Customers', true), th('ACV', true), th('Active now', true), th('$ / cust · 6 mo', true), th('12 mo', true), th('Retained 12', true), th('24 mo', true), th('Retained 24', true), th('36 mo', true), th('Retained 36', true))),
    el('tbody', {}, ...qRows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(r[0], false, { fontWeight: '700' }), td(fmt.int(r[1]), true), td(usd(r[2]), true), td(pct(r[3]), true), td(usd(r[4]), true), td(usd(r[5]), true), td(pct(r[6]), true), td(usd(r[7]), true), td(pct(r[8]), true), td(usd(r[9]), true), td(pct(r[10]), true)))))) : empty('No cohorts.');

  // By FieldRoutes source — directional until GoHighLevel attribution is clean (per Isaac, Nov 18).
  const chanOf = (src) => { const k = Object.keys(D.ch || {}); const s = String(src).toLowerCase(); return k.find(c => c.toLowerCase() === s) || (/facebook|meta/.test(s) ? k.find(c => /meta|facebook/i.test(c)) : /google ads/.test(s) ? k.find(c => /google ads/i.test(c)) : /local services/.test(s) ? k.find(c => /local services|lsa/i.test(c)) : null) || null; };
  const srcRows = Object.keys(L.groups).filter(id => id.indexOf('source:') === 0).map(id => { const Ms = ltvModel(id, { horizon: H, margin: MG }); const ch = chanOf(id.slice(7)); const cell = ch ? D.ch[ch] : null; const cacS = cell && cell.s && cell.spend ? cell.spend / cell.s : null; return { src: id.slice(7), Ms, ch, cacS, ratio: Ms && Ms.ltv && cacS ? Ms.ltv / cacS : null }; })
    .filter(r => r.Ms && r.Ms.nAll >= 200).sort((a, b) => (b.Ms.n || 0) - (a.Ms.n || 0));
  const sourceTable = srcRows.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
    el('thead', {}, el('tr', {}, th('FieldRoutes source'), th('New cust · 12 mo', true), th('ACV', true), th('Retained 12', true), th('LTV ' + H, true), th('Channel'), th('Mkt CAC · ' + _mklLblS(ym), true), th('LTV / CAC', true))),
    el('tbody', {}, ...srcRows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(r.src, false, { fontWeight: '700' }), td(fmt.int(r.Ms.n), true), td(usd(r.Ms.acv), true), td(pct(r.Ms.ret12), true), td(tilde(r.Ms, H) + usd(r.Ms.ltv), true, { fontWeight: '700' }), td(r.ch || '—', false, r.ch ? {} : muted), td(usd(r.cacS), true), td(x(r.ratio), true, { fontWeight: '800', color: ratioColor(r.ratio) })))))) : empty('No source cohorts with 200+ customers.');

  const method = el('div', { class: 'px-5 py-3 text-[11px] leading-relaxed border-t', style: Object.assign({ borderColor: 'var(--border)' }, muted) },
    el('b', {}, 'How this is built. '), 'A customer joins a cohort the month their first recurring subscription starts (residential only, one-time services out). LTV is what those customers actually paid RIDD, month by month, averaged per customer: the population’s own months while at least ' + LTV_MIN_N + ' customers are behind them, then RIDD’s all-customer curve scaled to the population’s first months (~ marks a number that leans on that projection). Retained = customers with an active subscription at the end of that month. CAC is the dashboard’s own: (marketing spend' + ' + wages + incentives) ÷ new sales with the initial pending or serviced, marketing spend alone until wages are entered. A gross margin % turns revenue LTV into contribution LTV. By-source numbers use the FieldRoutes source on the first subscription and are directional until GoHighLevel attribution is clean. Data: FieldRoutes via RevHawk, nightly', L.generatedAt ? ' (built ' + fmt.dateShort(String(L.generatedAt).slice(0, 10)) + ')' : '', '. ',
    el('button', { class: 'underline font-semibold', style: { color: 'var(--accent)' }, onclick: (ev) => _ltvKick(ev.currentTarget).then(() => { if (state._ltv) { close(); mklLtvPop(D, ym, cap); } }) }, 'Rebuild now'));

  const card = el('div', { class: 'card', style: { width: 'min(1180px, calc(100vw - 32px))', maxHeight: '88vh', overflow: 'auto', margin: '5vh auto 0' }, onclick: (e) => e.stopPropagation() },
    header, stats, charts,
    el('div', { class: 'p-4 grid gap-5', style: { gridTemplateColumns: '1fr' } },
      section('By office', 'Each office’s own ' + (pop === 'all:all' ? 'customers' : 'Inside Sales customers') + ' (projected on the office’s curve when it has 2,000+ customers, RIDD’s otherwise) against that office’s CAC for ' + _mklLblS(ym) + '.', officeTable),
      section('By start cohort', 'Observed only — what each quarter’s new customers have paid per customer so far, and how many are still active. A blank means that cohort is not old enough yet.', cohortTable),
      section('By FieldRoutes source · directional', 'LTV by the source on the first subscription; CAC by the matching marketing channel this month where the names line up.', sourceTable)),
    method);
  overlay.append(card); document.body.append(overlay); return overlay;
}
const _ltvCharts = {};
