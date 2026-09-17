// ┌─ src/86-reporting-inside-sales.js ─────────────────────────────────────────────────────
// │ Reporting → Inside Sales / Marketing P&L tables.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
function reportingInsideSales() {
  const gate = reportingDataGate();
  if (gate) return gate;
  // Lazy loads: manual cells + monthly channel spend (emitted by the marketing build).
  if (state.reportingIsManual == null && !state._isManualLoading) {
    state._isManualLoading = true;
    loadIsManual().then(() => { state._isManualLoading = false; mountApp(); });
  }
  // Marketing spend: pull LIVE from QuickBooks (/api/qbo-spend → Advertising &
  // Marketing by branch by month). Falls back to the static is-spend.json
  // snapshot if the QuickBooks function isn't configured yet (env vars unset).
  reportingLoadQboSpend();
  const MAN = state.reportingIsManual || {};
  const SP  = state.reportingIsSpend  || {};
  const rowsAll = state.reportingSubscriptions || [];

  const nowY = new Date().getFullYear();
  const monthsOf = (y) => Array.from({ length: 12 }, (_, i) => y + '-' + String(i + 1).padStart(2, '0'));
  const Y2 = String(nowY - 2), Y1 = String(nowY - 1), YTD = String(nowY);
  const months = monthsOf(nowY); // current-year months (YTD sums)
  // Month-over-month from two years back: each year's 12 months, then its total.
  const allMonths = [...monthsOf(Y2), ...monthsOf(Y1), ...months];
  const periods = [...monthsOf(Y2), Y2, ...monthsOf(Y1), Y1, ...months, YTD];
  const MONTH_LBL = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const colLabel = (p) => p === YTD ? (nowY + ' YTD') : (p.length === 4 ? p + ' Total' : MONTH_LBL[Number(p.slice(5)) - 1] + ' ' + p.slice(0, 4));

  // ── Auto aggregates from the snapshot (sold_date + committed-sold filter) ──
  const agg = {};
  const A = (p) => agg[p] || (agg[p] = { newRev: 0, newRevSvc: 0, upsell: 0, sold: 0, cv: 0 });
  const isExcludedSource = reportingExcludedSources();
  let anySoldDate = false;
  for (const r of rowsAll) {
    const sd = r.sold_date; if (!sd) continue;
    anySoldDate = true;
    const src = (r.subscription_source || '').trim();
    if (isExcludedSource.has(src || 'Unspecified')) continue; // Configurations exclusion
    if (reportingSourceClass(src) !== 'new') continue;        // NEW business only — exclude renewals AND upsells
    if (!reportingIsOfficeStaff(r)) continue;                 // Marketing = Office Staff accounts only
    if (!(r.customer_auto_pay && String(r.customer_auto_pay).trim())) continue; // committed sold
    const arv = Number(r.annual_recurring_value) || 0;
    const cv  = Number(r.subscription_contract_value) || 0;
    for (const p of [sd.slice(0, 4), sd.slice(0, 7)]) {
      const a = A(p);
      a.newRev += arv; a.sold += 1; a.cv += cv; if (r.initial_service) a.newRevSvc += arv;
    }
  }
  const G = (p) => agg[p] || { newRev: 0, newRevSvc: 0, upsell: 0, sold: 0, cv: 0 };

  // ── Channel spend (is-spend.json: {ym: {channel: amt}}) ──
  const chTotals = {};
  for (const ym in SP) for (const ch in SP[ym]) chTotals[ch] = (chTotals[ch] || 0) + SP[ym][ch];
  const channels = Object.keys(chTotals).sort((a, b) => chTotals[b] - chTotals[a]);
  const spendAt = (ch, p) => { let s = 0; for (const ym in SP) { if (ym.startsWith(p)) s += SP[ym][ch] || 0; } return s; };
  const mktAt = (p) => channels.reduce((s, c) => s + spendAt(c, p), 0);

  // ── Manual cells (months editable; year totals = sum of that year's months,
  //    falling back to a previously hand-entered year-level value). N/A is
  //    stored as a sentinel and excluded from all sums and stats. ──
  const NA_SENTINEL = -999999;
  const isNA = (v) => v != null && Number(v) === NA_SENTINEL;
  const sumMan = (ms, f) => { let s = null; for (const m of ms) { const v = MAN[m]?.[f]; if (v != null && !isNA(v)) { s = (s || 0) + Number(v); } } return s; };
  const manAt = (p, f) => {
    if (p === YTD) return sumMan(months, f);
    if (p.length === 4) { const s = sumMan(monthsOf(p), f); if (s != null) return s; const v = MAN[p]?.[f]; return (v == null || isNA(v)) ? null : Number(v); }
    const v = MAN[p]?.[f]; return (v == null || isNA(v)) ? null : Number(v);
  };

  // ── Formatting + color coding ──
  const usd = (v) => v == null ? '—' : '$' + Math.round(v).toLocaleString();
  const num = (v) => v == null ? '—' : Math.round(v).toLocaleString();
  const pct = (v) => v == null ? '—' : (v * 100).toFixed(1) + '%';
  const x2  = (v) => v == null ? '—' : v.toFixed(2);
  const GOOD = 'rgba(223,100,58,.18)', BAD = 'rgba(220,38,38,.14)';
  const shade = (v, goodIf, badIf) => v == null ? '' : (goodIf(v) ? GOOD : (badIf(v) ? BAD : ''));

  // Excel-style cells: full gridlines, dense rows, right-aligned numbers.
  const GRID = '1px solid var(--border)';
  const td = (content, bg, opts = {}) => el('td', {
    class: 'px-2.5 py-1 text-right tabular-nums whitespace-nowrap text-xs' + (opts.bold ? ' font-bold' : ''),
    style: { background: bg || 'transparent', border: GRID },
  }, content);
  const inputCell = (p, field, opts = {}) => {
    const v = MAN[p]?.[field];
    const na = isNA(v);
    return el('td', { class: 'p-0 text-right', style: { border: GRID } },
      el('input', {
        type: opts.allowNA ? 'text' : 'number', inputmode: 'decimal',
        value: na ? 'N/A' : (v == null ? '' : v), placeholder: '—',
        class: 'w-full text-right text-[11px] px-2.5 py-1',
        style: { background: 'transparent', border: 'none', outline: 'none', color: na ? 'var(--text-muted)' : 'var(--text)' },
        onfocus: (e) => { e.target.style.background = 'rgba(223,100,58,.12)'; },
        onblur: (e) => { e.target.style.background = 'transparent'; },
        onchange: (e) => {
          let val = e.target.value.trim();
          if (opts.allowNA && /^n\/?a$/i.test(val)) val = String(NA_SENTINEL);
          else if (opts.allowNA && val !== '' && isNaN(Number(val))) { toast('Enter a number or N/A', 'error'); e.target.value = na ? 'N/A' : (v == null ? '' : v); return; }
          saveIsManual(p, field, val).then(() => mountApp());
        },
      }));
  };
  const labelTd = (label, opts = {}) => el('td', {
    class: 'px-3 py-1 text-xs whitespace-nowrap sticky left-0' + (opts.bold ? ' font-bold' : '') + (opts.indent ? ' pl-6' : ''),
    style: { background: opts.section ? 'var(--card-2)' : 'var(--card)', color: opts.muted ? 'var(--text-muted)' : 'var(--text)', zIndex: 1, border: GRID, borderRight: '2px solid var(--border-2)' },
  }, label);
  const tr = (...cells) => el('tr', {}, ...cells);
  // Collapsible section headers — click to expand/collapse the rows beneath.
  const collapsed = state._isPnlCollapsed || (state._isPnlCollapsed = {});
  const sectionRow = (label) => el('tr', {
    class: 'cursor-pointer', title: 'Click to expand/collapse',
    onclick: () => { collapsed[label] = !collapsed[label]; mountApp(); },
  },
    el('td', { class: 'px-3 py-1.5 text-[10px] uppercase tracking-widest font-bold sticky left-0 select-none', style: { background: 'var(--card-2)', color: 'var(--text-subtle)', zIndex: 1, border: GRID, borderRight: '2px solid var(--border-2)' } },
      (collapsed[label] ? '▸ ' : '▾ ') + label),
    ...periods.map(() => el('td', { style: { background: 'var(--card-2)', border: GRID } })));

  const autoRow = (label, valFn, fmt, shadeFn, opts = {}) => tr(
    labelTd(label, opts),
    ...periods.map(p => { const v = valFn(p); return td(fmt(v), shadeFn ? shadeFn(v, p) : '', opts); }));
  const manualRow = (label, field, opts = {}) => tr(
    labelTd(label, { indent: false }),
    ...periods.map(p => p.length === 4
      ? td(usdOrNum(field, manAt(p, field)), '', { bold: false }) // year totals & YTD are computed
      : inputCell(p, field, opts)));
  const usdOrNum = (field, v) => (field === 'total_calls' || field === 'qualified_calls') ? num(v) : usd(v);

  // Derived helpers per period
  const revAt   = (p) => G(p).newRev;   // office-staff new revenue (upsells excluded)
  const wagesAt = (p) => manAt(p, 'wages');
  const incAt   = (p) => manAt(p, 'incentive_costs');
  const totalSpendAt = (p) => mktAt(p) + (wagesAt(p) || 0) + (incAt(p) || 0);
  const prevMonth = (p) => { if (p.length !== 7) return null; const i = allMonths.indexOf(p); return i > 0 ? allMonths[i - 1] : null; };

  const header = el('thead', { class: 'sticky top-0', style: { zIndex: 2 } }, el('tr', {},
    el('th', { class: 'px-3 py-2 text-left text-[10px] uppercase tracking-widest sticky left-0', style: { background: '#323230', color: '#fff', zIndex: 3, border: '1px solid #333', borderRight: '2px solid #555' } }, 'Inside Sales (MO)'),
    ...periods.map(p => el('th', {
      class: 'px-2.5 py-2 text-right text-[10px] uppercase tracking-wider whitespace-nowrap' + (p.length === 4 ? ' font-black' : ' font-semibold'),
      style: { background: '#323230', color: p.length === 4 ? 'var(--accent)' : '#fff', border: '1px solid #333' },
    }, colLabel(p)))));

  // Projections come from the PROJECTIONS tab of RIDD Reporting.xlsx (baked into
  // IS_PROJECTIONS). Read-only here so the model stays the source of truth; they
  // line up beside the actual rows below for a clean projection-vs-actual read.
  const curM0 = new Date().getMonth();
  // Projected revenue is the goal × seasonal model; projected SPEND lines are
  // derived from the editable per-year assumptions (% of revenue).
  const projRev = (p) => isProjectionAt(p, 'projected_revenue', nowY, curM0);
  const yearOf = (p) => /^\d{4}/.test(p) ? p.slice(0, 4) : null;
  const projOf = (p, field) => {
    if (field === 'projected_revenue') return projRev(p);
    const rev = projRev(p), yr = yearOf(p);
    if (rev == null || !yr) return null;
    if (field === 'projected_ad_spend')  return rev * isAssumptionFor(yr, 'ad_spend_pct');
    if (field === 'projected_wages')     return rev * isAssumptionFor(yr, 'wages_pct');
    if (field === 'projected_incentive') return rev * isAssumptionFor(yr, 'incentive_pct');
    return null;
  };
  // Each section splits into `detail` (hidden when collapsed) and `total` (the
  // bold summary row, ALWAYS shown). Collapsing hides the fluff but keeps totals.
  const SECTIONS = [
    { label: 'Projected (model + assumptions)',
      detail: () => [
        autoRow('Projected Revenue',    p => projOf(p, 'projected_revenue'),  usd, null),
        autoRow('Projected Ad Spend',   p => projOf(p, 'projected_ad_spend'), usd, null),
        autoRow('Projected Wages',      p => projOf(p, 'projected_wages'),    usd, null),
        autoRow('Projected Incentives', p => projOf(p, 'projected_incentive'),usd, null),
      ],
      total: () => [
        autoRow('Projected Total Spend', p => { const a = projOf(p, 'projected_ad_spend'), w = projOf(p, 'projected_wages'), i = projOf(p, 'projected_incentive'); return (a == null && w == null && i == null) ? null : (a || 0) + (w || 0) + (i || 0); }, usd, null, { bold: true }),
      ] },
    { label: 'Revenue (auto · office staff · sold date · payment on file)',
      detail: () => [
        autoRow('Serviced New Revenue', p => G(p).newRevSvc, usd, null, { indent: true }),
        autoRow('New Revenue (Sold)',   p => G(p).newRev,    usd, null),
      ],
      total: () => [ autoRow('TOTAL IS REVENUE', p => revAt(p), usd, null, { bold: true }) ] },
    { label: 'Marketing Spend (' + (state._isSpendSource === 'QuickBooks' ? 'live · QuickBooks' : 'QuickBooks feed unavailable') + ')',
      detail: () => [ ...channels.map(ch => autoRow(ch, p => spendAt(ch, p) || null, usd, null, { indent: true, muted: true })) ],
      total: () => [ autoRow('ACTUAL MARKETING SPEND', p => mktAt(p), usd, null, { bold: true }) ] },
    { label: 'Payroll (manual)',
      detail: () => [
        manualRow('Wages',           'wages'),
        manualRow('Incentive Costs', 'incentive_costs'),
      ],
      total: () => [ autoRow('TOTAL SPEND', p => totalSpendAt(p) || null, usd, null, { bold: true }) ] },
    { label: 'Calls (manual)',
      detail: () => [
        manualRow('Total Calls',     'total_calls'),
        manualRow('Qualified Calls', 'qualified_calls'),
      ],
      total: () => [] },
    { label: 'Stats',
      detail: () => [
        autoRow('Blended ROAS', p => { const m = mktAt(p); return m > 0 ? revAt(p) / m : null; }, x2, (v) => shade(v, x => x >= 3, x => x < 2), { bold: true }),
        autoRow('MoM Revenue Change', p => { const pm = prevMonth(p); if (!pm) return null; const a = revAt(pm); return a > 0 ? (revAt(p) - a) / a : null; }, pct, (v) => shade(v, x => x > 0, x => x < -0.1)),
        autoRow('% Marketing of IS Revenue', p => { const r = revAt(p); return r > 0 ? mktAt(p) / r : null; }, pct, (v) => shade(v, x => x <= 0.30, x => x > 0.40)),
        autoRow('% Wages of IS Revenue', p => { const r = revAt(p), w = wagesAt(p); return (r > 0 && w != null) ? w / r : null; }, pct, (v) => shade(v, x => x <= 0.25, x => x > 0.40)),
        autoRow('% Incentives of IS Revenue', p => { const r = revAt(p), i = incAt(p); return (r > 0 && i != null) ? i / r : null; }, pct, null),
        autoRow('Subscriptions Sold (#)', p => G(p).sold || null, num, null),
        autoRow('Close Rate (sold / qualified calls)', p => { const q = manAt(p, 'qualified_calls'); return q > 0 ? G(p).sold / q : null; }, pct, (v) => shade(v, x => x >= 0.20, x => x < 0.12)),
        autoRow('Weighted ACV', p => { const a = G(p); return a.sold > 0 ? a.cv / a.sold : null; }, usd, null),
        autoRow('Wages per Job', p => { const w = wagesAt(p), a = G(p); return (w != null && a.sold > 0) ? w / a.sold : null; }, usd, null),
        autoRow('Cost per Lead (calls)', p => { const c = manAt(p, 'total_calls'); return c > 0 ? mktAt(p) / c : null; }, usd, null),
        autoRow('Cost per Qualified Lead (Lace)', p => { const q = manAt(p, 'qualified_calls'); return q > 0 ? mktAt(p) / q : null; }, usd, null),
        autoRow('Cost per Job', p => { const a = G(p); return a.sold > 0 ? mktAt(p) / a.sold : null; }, usd, (v) => shade(v, x => x <= 350, x => x > 500)),
      ],
      total: () => [] },
  ];
  const bodyKids = [];
  for (const sec of SECTIONS) {
    bodyKids.push(sectionRow(sec.label));
    if (!collapsed[sec.label]) bodyKids.push(...sec.detail());
    bodyKids.push(...sec.total());   // total rows always show, even collapsed
  }
  const body = el('tbody', {}, ...bodyKids);

  const needsSchema = rowsAll.length > 0 && !anySoldDate;

  // ── Editable assumptions: spend modeled as % of revenue, per year ──
  const assumeYears = [Y2, Y1, YTD];
  const ASSUMP_ROWS = [['wages_pct', 'Wages'], ['ad_spend_pct', 'Ad Spend'], ['incentive_pct', 'Incentives']];
  const assumeInput = (y, key) => el('input', {
    type: 'text', inputmode: 'decimal',
    value: (isAssumptionFor(y, key) * 100).toFixed(1),
    class: 'w-14 text-right text-xs rounded border px-1 py-0.5',
    style: { background: 'var(--card)', borderColor: 'var(--border)', color: 'var(--text)' },
    onchange: (e) => { const v = e.target.value.replace(/[%\s,]/g, ''); if (v !== '' && isNaN(Number(v))) { toast('Enter a number', 'error'); return; } setAssumptionFor(y, key, v); mountApp(); },
  });
  const assumePanel = el('div', { class: 'card p-3' },
    el('div', { class: 'flex items-baseline gap-2 mb-2 flex-wrap' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Assumptions · spend as % of revenue'),
      el('div', { class: 'text-[10px] text-muted-' }, '— drives the Projected spend rows below')),
    el('div', { class: 'overflow-x-auto' },
      el('table', { class: 'text-xs' },
        el('thead', {}, el('tr', {},
          el('th', { class: 'text-left pr-5 py-1 font-semibold' }, ''),
          ...assumeYears.map(y => el('th', { class: 'px-2 py-1 text-right font-semibold', style: { color: 'var(--text-muted)' } }, y)))),
        el('tbody', {}, ...ASSUMP_ROWS.map(([key, label]) => el('tr', {},
          el('td', { class: 'pr-5 py-1 font-medium whitespace-nowrap' }, label),
          ...assumeYears.map(y => el('td', { class: 'px-2 py-1 text-right whitespace-nowrap' }, assumeInput(y, key), el('span', { class: 'text-[9px] text-muted- ml-0.5' }, '%')))))))));

  return el('div', { class: 'flex flex-col gap-3' },
    needsSchema && el('div', { class: 'card p-3 text-xs', style: { background: 'var(--card-2)' } },
      '⚠ No Sold Date on this snapshot yet. Run inside_sales_schema.sql in Supabase, then re-upload the Customer Report — revenue rows fill in from there.'),
    assumePanel,
    el('div', { class: 'card overflow-hidden' },
      (() => {
        // Open scrolled to the current months; remember position across edits/re-renders.
        const scroller = el('div', { class: 'overflow-x-auto', style: { maxHeight: '78vh' } },
          el('table', { class: 'w-full', style: { borderCollapse: 'collapse', minWidth: '1400px' } }, header, body));
        scroller.addEventListener('scroll', () => { state._isPnlScroll = scroller.scrollLeft; });
        setTimeout(() => { scroller.scrollLeft = state._isPnlScroll != null ? state._isPnlScroll : scroller.scrollWidth; }, 0);

        // ── Month slider: snap arrows + year jumps + drag-to-pan ──
        const lblW   = () => scroller.querySelector('thead th')?.offsetWidth || 0;
        const colThs = () => [...scroller.querySelectorAll('thead th')].slice(1);
        const goTo   = (left) => scroller.scrollTo({ left, behavior: 'smooth' });
        const jumpTo = (p) => { const t = colThs()[periods.indexOf(p)]; if (t) goTo(t.offsetLeft - lblW()); };
        const step   = (dir) => {
          const cur = scroller.scrollLeft, w = lblW(), ths = colThs();
          if (dir > 0) { const t = ths.find(th => th.offsetLeft - w > cur + 4); if (t) goTo(t.offsetLeft - w); }
          else { const before = ths.filter(th => th.offsetLeft - w < cur - 4); if (before.length) goTo(before[before.length - 1].offsetLeft - w); }
        };
        // Drag anywhere on the table to pan (ignores inputs; 5px threshold keeps clicks intact).
        let drag = null;
        scroller.addEventListener('pointerdown', (e) => {
          if (e.target.closest('input, button, select') || e.pointerType !== 'mouse') return;
          drag = { x: e.pageX, left: scroller.scrollLeft, live: false, id: e.pointerId };
        });
        scroller.addEventListener('pointermove', (e) => {
          if (!drag) return;
          const dx = e.pageX - drag.x;
          if (!drag.live && Math.abs(dx) > 5) { drag.live = true; scroller.setPointerCapture(drag.id); scroller.style.cursor = 'grabbing'; scroller.style.userSelect = 'none'; }
          if (drag.live) scroller.scrollLeft = drag.left - dx;
        });
        const endDrag = () => { if (drag) { drag = null; scroller.style.cursor = ''; scroller.style.userSelect = ''; } };
        scroller.addEventListener('pointerup', endDrag);
        scroller.addEventListener('pointercancel', endDrag);

        const navBtn = (txt, fn, title) => el('button', {
          class: 'px-2.5 py-1 text-[11px] rounded-lg border font-semibold transition hover:brightness-95',
          style: { borderColor: 'var(--border)', background: 'var(--card)', color: 'var(--text)' },
          title: title || '', onclick: fn,
        }, txt);
        const nav = el('div', { class: 'flex items-center gap-1.5 px-3 py-2 border-b flex-wrap', style: { borderColor: 'var(--border)' } },
          navBtn('‹', () => step(-1), 'Previous month'),
          navBtn('›', () => step(1), 'Next month'),
          el('div', { class: 'w-px h-4 mx-1', style: { background: 'var(--border)' } }),
          navBtn(Y2, () => jumpTo(Y2 + '-01'), 'Jump to Jan ' + Y2),
          navBtn(Y1, () => jumpTo(Y1 + '-01'), 'Jump to Jan ' + Y1),
          navBtn(YTD, () => jumpTo(YTD + '-01'), 'Jump to Jan ' + YTD),
          navBtn('Latest', () => goTo(scroller.scrollWidth), 'Jump to most recent'),
          el('span', { class: 'text-[10px] ml-auto hidden sm:block', style: { color: 'var(--text-subtle)' } }, 'Drag the table to pan'),
        );
        return el('div', {}, nav, scroller);
      })()),
    el('div', { class: 'text-[11px]', style: { color: 'var(--text-subtle)' } },
      'Auto rows compute from the active snapshot (Inside Sales sources, sold date, payment on file) and the marketing spend feed. White input cells are hand-entered and shared with every admin. Green/red shading uses default thresholds — tell me if you want them tuned.'),
  );
}

function reportingUploadsPanel() {
  const uploads = state.reportingUploads || [];
  return el('div', { class: 'card p-4' },
    el('h2', { class: 'text-lg font-bold mb-1' }, 'Uploads'),
    el('p', { class: 'text-xs text-muted- mb-4' },
      'Each row is an all-time data snapshot, shared across everyone on the account. Click any row to load that snapshot ' +
      '(or pick it from the dropdown at the top). Delete removes the snapshot and all its rows.'),
    uploads.length === 0
      ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, 'No uploads yet.')
      : el('div', { class: 'rounded-lg border', style: { borderColor: 'var(--border)', maxHeight: '440px', overflowY: 'auto' } },
          el('table', { class: 'w-full text-sm' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)', position: 'sticky', top: '0', zIndex: '10' } },
              el('tr', {},
                el('th', { class: 'text-left pl-4 pr-2 py-2.5 font-semibold' }, 'Filename'),
                el('th', { class: 'text-left px-2 py-2.5 font-semibold' }, 'Uploaded'),
                el('th', { class: 'text-right px-2 py-2.5 font-semibold' }, 'Rows'),
                el('th', { class: 'text-right pr-4 pl-2 py-2.5 font-semibold', style: { width: '120px' } }, ''),
              ),
            ),
            el('tbody', {},
              ...uploads.map(u => {
                const isActive = u.id === state.reportingActiveUploadId;
                return el('tr', {
                  class: 'border-t cursor-pointer hover:brightness-95 transition',
                  style: { borderColor: 'var(--border)', background: isActive ? 'rgba(223,100,58,.08)' : 'transparent' },
                  title: isActive ? 'This snapshot is currently loaded' : 'Click to load this snapshot',
                  onclick: () => {
                    if (u.id === state.reportingActiveUploadId) return;
                    state.reportingActiveUploadId = u.id;
                    state.reportingSubscriptions = [];
                    state.reportingSubscriptionsLoadedFor = null;
                    mountApp();
                    logActivity('snapshot_change', { detail: 'Switched to snapshot ' + (u.filename || u.id) });
                    toast('Loading snapshot: ' + (u.filename || u.id), 'info');
                  },
                },
                  el('td', { class: 'pl-4 pr-2 py-2.5' },
                    el('div', { class: 'font-medium' }, u.filename || '(no filename)'),
                    isActive && el('div', {
                      class: 'text-[10px] uppercase tracking-wider font-semibold mt-0.5',
                      style: { color: 'var(--accent)' },
                    }, 'Active'),
                  ),
                  el('td', { class: 'px-2 py-2.5 text-xs text-muted-' },
                    u.uploaded_at ? new Date(u.uploaded_at).toLocaleString() : ''),
                  el('td', { class: 'px-2 py-2.5 text-right tabular-nums' },
                    (u.row_count || 0).toLocaleString()),
                  el('td', { class: 'pr-4 pl-2 py-2.5 text-right' },
                    el('button', {
                      class: 'text-[11px] px-2.5 py-1 rounded-lg font-semibold transition hover:brightness-95',
                      style: { color: '#DC2626', border: '1px solid var(--border)', background: 'transparent' },
                      onclick: async (e) => {
                        e.stopPropagation();
                        if (!confirm('Delete this snapshot and all its rows? This can’t be undone.')) return;
                        logActivity('snapshot_change', { detail: 'Deleted snapshot ' + (u.filename || u.id) });
                        e.currentTarget.disabled = true;
                        if (DEMO) {
                          state.reportingUploads = (state.reportingUploads || []).filter(x => x.id !== u.id);
                          if (isActive) {
                            state.reportingActiveUploadId = state.reportingUploads[0]?.id || null;
                            state.reportingSubscriptions = [];
                            state.reportingSubscriptionsLoadedFor = null;
                          }
                          saveDemoData();
                          mountApp();
                          toast('Snapshot deleted', 'success');
                          return;
                        }
                        const { error } = await supabase.from('reporting_uploads').delete().eq('id', u.id);
                        if (error) { toast('Delete failed: ' + error.message, 'error'); return; }
                        if (u.storage_path) {
                          try { await supabase.storage.from('reporting').remove([u.storage_path]); } catch {}
                        }
                        if (isActive) {
                          state.reportingActiveUploadId = null;
                          state.reportingSubscriptions = [];
                          state.reportingSubscriptionsLoadedFor = null;
                        }
                        await loadReportingMetadata();
                        mountApp();
                        toast('Snapshot deleted', 'success');
                      },
                    }, 'Delete'),
                  ),
                );
              }),
            ),
          ),
        ),
  );
}

// ──────────────────────────────────────────────────────────────────────────
// REPORTING — Geographic Distribution sub-tab
// ──────────────────────────────────────────────────────────────────────────
// Leaflet state-level choropleth + sortable ZIP-level table. The map's
// active metric toggles between ACV, Customer count, and Attrition rate.
// Zip-level attrition only counts ZIPs with 10+ subs so a single cancel
// in a tiny ZIP doesn't read as "100% attrition".

// Two-letter state code lookup. The GeoJSON we use exposes full state
// names; CSV rows use 2-letter codes. This bridges the two so the map
// can color each polygon by the matching state's aggregate.
const REPORTING_STATE_NAME_TO_CODE = {
  'Alabama':'AL','Alaska':'AK','Arizona':'AZ','Arkansas':'AR','California':'CA','Colorado':'CO',
  'Connecticut':'CT','Delaware':'DE','District of Columbia':'DC','Florida':'FL','Georgia':'GA',
  'Hawaii':'HI','Idaho':'ID','Illinois':'IL','Indiana':'IN','Iowa':'IA','Kansas':'KS',
  'Kentucky':'KY','Louisiana':'LA','Maine':'ME','Maryland':'MD','Massachusetts':'MA',
  'Michigan':'MI','Minnesota':'MN','Mississippi':'MS','Missouri':'MO','Montana':'MT',
  'Nebraska':'NE','Nevada':'NV','New Hampshire':'NH','New Jersey':'NJ','New Mexico':'NM',
  'New York':'NY','North Carolina':'NC','North Dakota':'ND','Ohio':'OH','Oklahoma':'OK',
  'Oregon':'OR','Pennsylvania':'PA','Rhode Island':'RI','South Carolina':'SC',
  'South Dakota':'SD','Tennessee':'TN','Texas':'TX','Utah':'UT','Vermont':'VT',
  'Virginia':'VA','Washington':'WA','West Virginia':'WV','Wisconsin':'WI','Wyoming':'WY',
  'Puerto Rico':'PR',
};

// Reverse lookup: 2-letter code → full state name. Needed to build the
// OpenDataDE ZIP GeoJSON URL (per-state files keyed on lowercase name).
const REPORTING_STATE_CODE_TO_NAME = Object.fromEntries(
  Object.entries(REPORTING_STATE_NAME_TO_CODE).map(([n, c]) => [c, n])
);

// 2-letter state code → 2-digit state FIPS. The national counties GeoJSON
// (plotly geojson-counties-fips) tags every county polygon with its state
// FIPS in properties.STATE, so we filter that big file down to one state's
// counties by matching this code.
const REPORTING_STATE_CODE_TO_FIPS = {
  AL:'01', AK:'02', AZ:'04', AR:'05', CA:'06', CO:'08', CT:'09', DE:'10',
  DC:'11', FL:'12', GA:'13', HI:'15', ID:'16', IL:'17', IN:'18', IA:'19',
  KS:'20', KY:'21', LA:'22', ME:'23', MD:'24', MA:'25', MI:'26', MN:'27',
  MS:'28', MO:'29', MT:'30', NE:'31', NV:'32', NH:'33', NJ:'34', NM:'35',
  NY:'36', NC:'37', ND:'38', OH:'39', OK:'40', OR:'41', PA:'42', RI:'44',
  SC:'45', SD:'46', TN:'47', TX:'48', UT:'49', VT:'50', VA:'51', WA:'53',
  WV:'54', WI:'55', WY:'56', PR:'72',
};

// OpenDataDE publishes per-state ZCTA boundaries via this pattern:
//   xx_state_name_zip_codes_geo.min.json
// e.g. ut_utah_zip_codes_geo.min.json, ga_georgia_zip_codes_geo.min.json
// Files are ~1-5MB each, lazy-loaded on first drill into each state.
function reportingStateZipUrl(code) {
  const name = REPORTING_STATE_CODE_TO_NAME[code];
  if (!name) return null;
  const slug = name.toLowerCase().replace(/ /g, '_');
  // jsdelivr blocks this repo with 403 (size-based limit). Falling back
  // to raw.githubusercontent.com — slower edge but unblocked.
  return 'https://raw.githubusercontent.com/OpenDataDE/State-zip-code-GeoJSON/master/'
    + code.toLowerCase() + '_' + slug + '_zip_codes_geo.min.json';
}

// Lazy-load a single state's ZIP boundaries. Cached on window so
// re-renders (metric toggle, filter changes) don't re-fetch the same
// 1-5MB payload.
// Fetch with a deadline — a hung connection to a boundary CDN used to leave
// the map on "Loading…" forever with zero signal.
async function _geoFetchJson(url, timeoutMs) {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const t = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs || 60000) : null;
  try {
    const res = await fetch(url, ctrl ? { signal: ctrl.signal } : undefined);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    return await res.json();
  } finally { if (t) clearTimeout(t); }
}
async function loadReportingZipGeo(stateCode) {
  if (!stateCode) return null;
  window._reportingZipGeoCache = window._reportingZipGeoCache || {};
  if (window._reportingZipGeoCache[stateCode]) return window._reportingZipGeoCache[stateCode];
  // Boundaries never change — keep them in IndexedDB across reloads so the
  // 1-5MB GitHub fetch happens once per browser, not once per visit.
  const idbKey = 'geo:' + stateCode;
  const stored = await reportingIdbGet(idbKey);
  if (stored && stored.type === 'FeatureCollection') { window._reportingZipGeoCache[stateCode] = stored; return stored; }
  const url = reportingStateZipUrl(stateCode);
  if (!url) return null;
  // Primary (raw.githubusercontent) + a mirror of the same repo — corporate
  // networks and extensions sometimes block one but not the other.
  const urls = [url, url.replace('https://raw.githubusercontent.com/', 'https://cdn.statically.io/gh/')];
  for (const u of urls) {
    try {
      const geo = await _geoFetchJson(u, 90000);
      window._reportingZipGeoCache[stateCode] = geo;
      reportingIdbPutKeep(idbKey, geo);
      return geo;
    } catch (e) {
      console.warn('[ridd] zip GeoJSON failed for ' + stateCode + ' via ' + u.split('/')[2], e && e.message);
    }
  }
  return null;
}

// Normalize a county name so CSV values match GeoJSON polygon names. The
// data may carry "Salt Lake County" while the boundary file calls it
// "Salt Lake"; punctuation and spacing also vary ("St. Louis" / "St Louis",
// "DeKalb" / "De Kalb"). We strip the trailing descriptor word, then drop
// everything that isn't a letter or digit so the two sides line up.
// Map stack (Leaflet + Turf, ~700KB combined) loads ON DEMAND the first
// time a geographic view renders. It used to ship as deferred tags on every
// page load — most sessions never open the map, so everyone paid the
// download tax for a tab few visit. The CSS goes in immediately (cheap);
// scripts resolve one shared promise so concurrent renders don't double-inject.
let _mapLibsPromise = null;
function ensureMapLibs() {
  if (typeof L !== 'undefined' && typeof turf !== 'undefined') return Promise.resolve();
  if (_mapLibsPromise) return _mapLibsPromise;
  const script = (url) => new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = url; s.async = true;
    s.onload = res; s.onerror = () => rej(new Error('map lib failed to load: ' + url));
    document.head.appendChild(s);
  });
  // The CSS must be IN before any L.map() runs — Leaflet measures the
  // container and positions tiles at init, and doing that against an
  // unstyled layout leaves a permanently gray map. So the stylesheet is
  // part of the same promise the map render waits on.
  const style = () => new Promise((res) => {
    if (document.querySelector('link[href*="leaflet.css"]')) return res();
    const css = document.createElement('link');
    css.rel = 'stylesheet';
    css.href = 'https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.css';
    css.onload = res;
    css.onerror = res;                      // styling worst-case beats never rendering
    setTimeout(res, 4000);                  // never hang the map on a slow stylesheet
    document.head.appendChild(css);
  });
  _mapLibsPromise = Promise.all([
    style(),
    script('https://cdn.jsdelivr.net/npm/leaflet@1.9.4/dist/leaflet.js'),
    script('https://cdnjs.cloudflare.com/ajax/libs/Turf.js/6.5.0/turf.min.js'),
  ]).catch((e) => { _mapLibsPromise = null; throw e; });   // allow retry on a flaky connection
  return _mapLibsPromise;
}

function reportingNormCounty(name) {
  let s = String(name == null ? '' : name).toLowerCase().trim();
  s = s.replace(/\s+(county|parish|borough|census area|city and borough|municipality|municipio)\s*$/,'');
  s = s.replace(/[^a-z0-9]/g, '');
  return s;
}

// Lazy-load the national US counties boundary file (one ~3MB payload keyed
// on 5-digit FIPS). Cached on window so drilling between states or toggling
// the metric doesn't re-fetch. We load the whole country once and filter to
// the active state in initReportingCountyMap rather than per-state files —
// there's no reliable per-state county GeoJSON CDN the way there is for ZIPs.
async function loadReportingCountyGeo() {
  if (window._reportingCountyGeo) return window._reportingCountyGeo;
  const urls = [
    'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json',
    'https://cdn.statically.io/gh/plotly/datasets/master/geojson-counties-fips.json',
  ];
  for (const u of urls) {
    try {
      const geo = await _geoFetchJson(u, 90000);
      window._reportingCountyGeo = geo;
      return geo;
    } catch (e) { console.warn('[ridd] county GeoJSON failed via ' + u.split('/')[2], e && e.message); }
  }
  return null;
}

// Render a state-level ZIP choropleth. Same color logic as the country
// map but bounded to the state's zips. Click any zip → drill modal.
// When `highlightZip` is set, the map zooms to that zip's polygon and
// renders it with a red border so a table-row click is mirrored in the map.
// Dissolve the office's service ZIPs into one region (fill interior gaps, drop
// detached islands) and trace the outer edge in red over a Leaflet map. Shared
// by the ZIP map and the County map so the boundary shows in both drill modes.
function drawReportingServiceBoundary(map, zipGeo, serviceZips) {
  if (!serviceZips || !serviceZips.size || typeof turf === 'undefined' || !zipGeo) return;
  try {
    let merged = null;
    zipGeo.features.forEach(f => {
      const zip = String(f.properties.ZCTA5CE10 || f.properties.zip || '').padStart(5, '0');
      if (!serviceZips.has(zip)) return;
      let sf; try { sf = turf.simplify(f, { tolerance: 0.004, highQuality: false }); } catch { sf = f; }
      if (!merged) { merged = sf; return; }
      try { merged = turf.union(merged, sf) || merged; } catch {}
    });
    if (!merged) return;
    const parts = merged.geometry.type === 'MultiPolygon'
      ? merged.geometry.coordinates.map(c => turf.polygon([c[0]]))
      : [turf.polygon([merged.geometry.coordinates[0]])];
    // Keep every real cluster — a market can have several disconnected service
    // pockets (Charleston = Charleston metro + Beaufort + Savannah; Myrtle Beach
    // spans the Pee Dee + Wilmington, etc.). Only drop micro-slivers thrown off
    // by the dissolve (< ~0.4 km²), NOT legitimate satellite clusters.
    const withA = parts.map(p => ({ p, a: turf.area(p) }));
    const keep = withA.filter(x => x.a >= 4e5).map(x => x.p);
    L.geoJSON({ type: 'FeatureCollection', features: keep }, {
      interactive: false,
      style: { color: '#e11d2e', weight: 3.5, opacity: 0.95, fill: false },
    }).addTo(map);
  } catch (e) { console.warn('[ridd] service-area overlay failed', e); }
}

function initReportingZipMap(containerId, stateCode, zipsInState, metricKey, metricLabel, fmtMetric, onZipClick, highlightZip, serviceZips, svcColorMap) {
  if (typeof L === 'undefined') return;
  const container = document.getElementById(containerId);
  if (!container) return;
  if (container._leafletMap) {
    try { container._leafletMap.remove(); } catch {}
    container._leafletMap = null;
  }
  // Loading state until GeoJSON arrives.
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:12px;">Loading ZIP boundaries…</div>';

  const map = L.map(container, {
    zoom: 6,
    zoomControl: true,
    // Scroll-wheel zoom on at state level — the user has drilled in
    // specifically to look at zip detail, so scroll-to-zoom is what
    // they want. (Country view keeps it off to avoid hijacking page
    // scroll when the user is just navigating past the map.)
    scrollWheelZoom: true,
  });
  container._leafletMap = map;
  // Basemap: Esri Light Gray Canvas — same quiet look as the old CARTO light
  // tiles, free with attribution and NO API key (CARTO gates its basemaps now).
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles \u00a9 Esri \u2014 Esri, HERE, Garmin, \u00a9 OpenStreetMap contributors',
    maxZoom: 14,
  }).addTo(map);
  setTimeout(() => { try { map.invalidateSize(); } catch (e) { /* torn down */ } }, 400);
  // Provisional view so tiles paint IMMEDIATELY — the old code set no
  // center at all until the boundaries arrived, which reads as "broken
  // gray box" during a multi-MB download. fitBounds refines it below.
  try { map.setView([37.5, -85], 5); } catch (e) { /* fine */ }

  // Build a quick ZIP→aggregate lookup for the state's data.
  const byZip = new Map();
  for (const z of zipsInState) byZip.set(String(z.zip), z);

  // Branches cross state lines (Savannah = GA+SC, Myrtle Beach = SC+NC), so
  // the drill may carry neighbor-state ZIPs. Files render INCREMENTALLY —
  // the drilled state paints the moment its file lands, neighbors layer in
  // after — with a visible progress pill (the states' ZIP files run 3-30MB
  // each; an all-or-nothing merge looked exactly like a dead map).
  const _geoStates = [...new Set(zipsInState.map(z => z.state))].filter(s => REPORTING_STATE_CODE_TO_NAME[s]);
  {
    const i = _geoStates.indexOf(stateCode);
    if (i > 0) { _geoStates.splice(i, 1); _geoStates.unshift(stateCode); }
    else if (i < 0 && REPORTING_STATE_CODE_TO_NAME[stateCode]) _geoStates.unshift(stateCode);
  }
  const _statusEl = document.createElement('div');
  _statusEl.style.cssText = 'position:absolute;left:50%;top:10px;transform:translateX(-50%);z-index:800;background:rgba(29,29,29,.78);color:#fff;font-size:11px;padding:4px 12px;border-radius:999px;pointer-events:none;white-space:nowrap;';
  _statusEl.textContent = 'Loading ZIP boundaries (' + _geoStates.length + ' state file' + (_geoStates.length === 1 ? '' : 's') + ')…';
  container.appendChild(_statusEl);

  // ── ZIP selection mode (per Isaac) ──────────────────────────────────
  // Toggle "Select ZIPs", then click zips to build a highlighted set —
  // exactly the yellow-territory look of a printed zip map. The pill
  // shows live totals for the selection; Copy grabs the zip list.
  const _selSet = state._geoZipSel || (state._geoZipSel = new Set());
  const _layerByZip = new Map();          // zip -> polygon layer (restyle on toggle)
  const _labelPts = [];                   // { ll, zip } for zoomed-in zip labels
  container._zipSelectMode = !!state._geoZipSelMode;
  const SEL_STYLE = { fillColor: '#FFD84D', fillOpacity: 0.9, color: '#C8552E', weight: 1.6 };
  const _selBtn = document.createElement('button');
  _selBtn.style.cssText = 'position:absolute;right:10px;top:10px;z-index:801;font:700 11px Archivo,sans-serif;padding:6px 10px;border:1px solid #323230;cursor:pointer;';
  const _paintSelBtn = () => {
    _selBtn.textContent = container._zipSelectMode ? '\u2713 Selecting ZIPs \u2014 click zips' : 'Select ZIPs';
    _selBtn.style.background = container._zipSelectMode ? '#DF643A' : '#fff';
    _selBtn.style.color = container._zipSelectMode ? '#000' : '#323230';
  };
  _paintSelBtn();
  _selBtn.onclick = () => { container._zipSelectMode = state._geoZipSelMode = !container._zipSelectMode; _paintSelBtn(); _paintSummary(); };
  container.appendChild(_selBtn);
  const _sumEl = document.createElement('div');
  _sumEl.style.cssText = 'position:absolute;left:10px;bottom:10px;z-index:801;background:#fff;border:1px solid #323230;font:600 11px Archivo,sans-serif;color:#323230;padding:6px 10px;display:none;align-items:center;gap:10px;';
  container.appendChild(_sumEl);
  const _paintSummary = () => {
    if (!_selSet.size) { _sumEl.style.display = 'none'; return; }
    let subs = 0, arr = 0, withData = 0;
    _selSet.forEach(zip => { const z = byZip.get(zip) || byZip.get(zip.replace(/^0+/, '')); if (z) { withData++; subs += (z.subs || 0); arr += (z.arv || 0); } });
    _sumEl.style.display = 'flex';
    _sumEl.innerHTML = '';
    const txt = document.createElement('span');
    txt.textContent = _selSet.size + ' ZIP' + (_selSet.size === 1 ? '' : 's') + ' \u00b7 ' + subs.toLocaleString() + ' subs \u00b7 ' + fmt.usd0(arr) + (withData < _selSet.size ? ' \u00b7 ' + (_selSet.size - withData) + ' no data' : '');
    _sumEl.appendChild(txt);
    const mkA = (label, fn) => { const a = document.createElement('button'); a.textContent = label; a.style.cssText = 'font:700 10px Archivo,sans-serif;text-transform:uppercase;letter-spacing:.05em;border:none;background:none;color:#C8552E;cursor:pointer;padding:0;'; a.onclick = fn; _sumEl.appendChild(a); };
    mkA('Copy', () => { try { navigator.clipboard.writeText([..._selSet].sort().join(', ')); toast('Copied ' + _selSet.size + ' ZIPs', 'success'); } catch (e) { toast('Copy failed', 'error'); } });
    mkA('Clear', () => { const zips = [..._selSet]; _selSet.clear(); zips.forEach(z => { const l = _layerByZip.get(z); if (l && l._baseStyle) l.setStyle(l._baseStyle); }); _paintSummary(); });
  };
  _paintSummary();
  const _toggleSel = (zip, layerObj) => {
    if (_selSet.has(zip)) { _selSet.delete(zip); if (layerObj._baseStyle) layerObj.setStyle(layerObj._baseStyle); }
    else { _selSet.add(zip); layerObj.setStyle(SEL_STYLE); try { layerObj.bringToFront(); } catch (e) {} }
    _paintSummary();
  };
  // ZIP number labels once zoomed in (like a printed zip map) — rebuilt
  // for the visible viewport on every move so a state's ~1k zips never
  // all mount at once.
  const _labelLayer = L.layerGroup().addTo(map);
  const _refreshLabels = () => {
    _labelLayer.clearLayers();
    if (map.getZoom() < 9) return;
    const b = map.getBounds().pad(0.1);
    let n = 0;
    for (const pt of _labelPts) {
      if (!b.contains(pt.ll)) continue;
      if (++n > 400) break;
      _labelLayer.addLayer(L.tooltip({ permanent: true, direction: 'center', className: 'zip-label', interactive: false, opacity: 1 })
        .setLatLng(pt.ll).setContent(pt.zip));
    }
  };
  map.on('zoomend moveend', _refreshLabels);

  (() => {
    // Quintile scale across just this state's zips so the color spread
    // is meaningful inside the state (one big zip doesn't dominate).
    const zipMetricFor = (z) => {
      if (!z) return null;
      // Service Types: only color ZIPs with MORE THAN 10 distinct service types
      // (others fade out). Click opens the top-10 popup.
      if (metricKey === 'service') {
        const distinct = new Set((z.rows || []).map(r => r.subscription || 'Unknown')).size;
        return distinct > 10 ? reportingDomService(z.rows) : null;
      }
      if (metricKey === 'acv')        return z.avgContract;
      if (metricKey === 'revenue')    return z.arv;
      if (metricKey === 'customers')  return z.customers;
      if (metricKey === 'subs')       return z.subs;
      if (metricKey === 'attrition')  return z.attritionEligible ? z.cancelRate : null;
      if (metricKey === 'retention')  return z.attritionEligible ? (1 - z.cancelRate) : null;
      return 0;
    };
    const colorFor = metricKey === 'service'
      ? (name) => (svcColorMap && svcColorMap.get(name)) || REPORTING_SVC_OTHER
      : reportingQuantileScale(zipsInState.map(zipMetricFor), metricKey);

    // Track the highlighted polygon so we can pop it visually and zoom
    // to it after the geo layer is laid down.
    let highlightedPolygon = null;
    const normalizedTarget = highlightZip ? String(highlightZip).padStart(5, '0') : null;

    const addGeoLayer = (geo, isFirst) => {
    const layer = L.geoJSON(geo, {
      style: (feature) => {
        // OpenDataDE uses ZCTA5CE10 as the 5-digit zip property name.
        const zip = String(feature.properties.ZCTA5CE10 || feature.properties.zip || '').padStart(5, '0');
        const z = byZip.get(zip) || byZip.get(zip.replace(/^0+/, ''));
        const isHighlight = normalizedTarget && zip === normalizedTarget;
        const v = zipMetricFor(z);
        const base = {
          fillColor: colorFor(v),
          // Fade ZIPs with no qualifying value (e.g. ≤10 service types, or
          // below the attrition sub-floor) so the colored ones stand out.
          fillOpacity: isHighlight ? 0.95 : (v == null ? 0.1 : (z ? 0.85 : 0.15)),
          color: isHighlight ? '#DC2626' : '#7C857A',
          weight: isHighlight ? 3 : 0.4,
        };
        return _selSet.has(zip) ? SEL_STYLE : base;
      },
      onEachFeature: (feature, layerObj) => {
        const zip = String(feature.properties.ZCTA5CE10 || feature.properties.zip || '').padStart(5, '0');
        const z = byZip.get(zip) || byZip.get(zip.replace(/^0+/, ''));
        const isHighlight = normalizedTarget && zip === normalizedTarget;
        if (isHighlight) highlightedPolygon = layerObj;
        _layerByZip.set(zip, layerObj);
        try { _labelPts.push({ ll: layerObj.getBounds().getCenter(), zip }); } catch (e) {}
        try { layerObj._baseStyle = layer.options.style(feature); } catch (e) {}
        if (!z) {
          layerObj.bindTooltip('ZIP ' + zip + '<br><i>No data in current filter</i>', { sticky: true });
          layerObj.on('click', () => { if (container._zipSelectMode) _toggleSel(zip, layerObj); });
          return;
        }
        const v = zipMetricFor(z);
        const distinctSvc = metricKey === 'service' ? new Set((z.rows || []).map(r => r.subscription || 'Unknown')).size : 0;
        const display = v == null
          ? (metricKey === 'service' ? distinctSvc + ' service types (need 11+)' : '< 10 subs')
          : (metricKey === 'service' ? distinctSvc + ' service types · click for top 10' : fmtMetric(v));
        const tooltipHtml = '<b>ZIP ' + zip + '</b><br>'
          + metricLabel + ': ' + display + '<br>'
          + z.subs + ' subs · ' + z.customers + ' customers';
        layerObj.bindTooltip(tooltipHtml, { sticky: true });
        layerObj.on('click', () => { if (container._zipSelectMode) _toggleSel(zip, layerObj); else onZipClick(z); });
        // Mouseover / mouseout reset to the default border. Skip the
        // reset for the highlighted polygon so the red ring stays
        // visible even after the user mouses over it.
        layerObj.on('mouseover', (e) => {
          if (!isHighlight && !_selSet.has(zip)) e.target.setStyle({ weight: 2, color: '#323230' });
        });
        layerObj.on('mouseout',  (e) => {
          if (!isHighlight && !_selSet.has(zip)) e.target.setStyle({ weight: 0.4, color: '#7C857A' });
        });
      },
    }).addTo(map);
      if (highlightedPolygon && highlightedPolygon._map) {
        try {
          map.fitBounds(highlightedPolygon.getBounds(), { padding: [60, 60], maxZoom: 12 });
          highlightedPolygon.bringToFront();
          highlightedPolygon.openTooltip();
        } catch (e) { /* fine */ }
      } else if (isFirst) {
        try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }); } catch (e) { /* fine */ }
      }
    };

    let _okCount = 0, _pending = _geoStates.length;
    const _allFeats = [];
    _geoStates.forEach((code, idx) => {
      loadReportingZipGeo(code).then(g => {
        // A re-render may have replaced the map while this file was in
        // flight — never draw onto a superseded instance.
        if (container._leafletMap !== map) return;
        _pending--;
        if (g && g.features && g.features.length) {
          _okCount++;
          _allFeats.push(...g.features);
          addGeoLayer(g, idx === 0 || _okCount === 1);
        }
        if (_pending > 0) {
          _statusEl.textContent = 'Loading ZIP boundaries — ' + (_geoStates.length - _pending) + ' of ' + _geoStates.length + ' states in…';
        } else {
          _statusEl.remove();
          if (!_okCount) {
            container.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;gap:6px;"><div>ZIP boundary data could not be downloaded (network blocked or timed out).</div><div style="font-size:11px;">The table below has the same ZIP-level numbers.</div></div>';
            return;
          }
          if (_allFeats.length) drawReportingServiceBoundary(map, { type: 'FeatureCollection', features: _allFeats }, serviceZips);
        }
      });
    });
  })();
}

// Render a state-level COUNTY choropleth — the county-mode sibling of
// initReportingZipMap. Same color logic and drill behavior; the only real
// difference is the boundary source (one national file filtered to this
// state by FIPS) and that polygons match data by normalized county name
// rather than ZIP code. When `highlightCounty` is set, that county's
// polygon gets a red ring and the map zooms to it.
function initReportingCountyMap(containerId, stateCode, countiesInState, metricKey, metricLabel, fmtMetric, onCountyClick, highlightCounty, serviceZips, svcColorMap) {
  if (typeof L === 'undefined') return;
  const container = document.getElementById(containerId);
  if (!container) return;
  if (container._leafletMap) {
    try { container._leafletMap.remove(); } catch {}
    container._leafletMap = null;
  }
  container.innerHTML = '<div style="display:flex;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:12px;">Loading county boundaries…</div>';

  const map = L.map(container, {
    zoom: 6,
    zoomControl: true,
    scrollWheelZoom: true,
  });
  container._leafletMap = map;
  // Basemap: Esri Light Gray Canvas — same quiet look as the old CARTO light
  // tiles, free with attribution and NO API key (CARTO gates its basemaps now).
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles \u00a9 Esri \u2014 Esri, HERE, Garmin, \u00a9 OpenStreetMap contributors',
    maxZoom: 14,
  }).addTo(map);
  setTimeout(() => { try { map.invalidateSize(); } catch (e) { /* torn down */ } }, 400);

  // Keyed on state-FIPS + normalized name — the drill can include
  // neighbor-state counties (cross-border branches) and county names
  // repeat across states (every state has a Washington).
  const byCounty = new Map();
  const _cKey = (fips, name) => (fips || '??') + '|' + reportingNormCounty(name);
  for (const c of countiesInState) byCounty.set(_cKey(REPORTING_STATE_CODE_TO_FIPS[c.state], c.county), c);

  const stateFips = REPORTING_STATE_CODE_TO_FIPS[stateCode];
  const _drillFips = new Set(countiesInState.map(c => REPORTING_STATE_CODE_TO_FIPS[c.state]).filter(Boolean));
  if (stateFips) _drillFips.add(stateFips);

  loadReportingCountyGeo().then(geo => {
    if (!geo || !geo.features) {
      container.innerHTML = '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;color:var(--text-muted);font-size:13px;gap:6px;"><div>County boundary data unavailable.</div><div style="font-size:11px;">Fall back to the table below for county-level breakdowns.</div></div>';
      return;
    }

    // Filter the national file down to this state's counties so the layer
    // is small and name collisions across states can't happen.
    const featureState = (f) => (f.properties && f.properties.STATE) || String(f.id || '').slice(0, 2);
    const stateFeatures = _drillFips.size
      ? geo.features.filter(f => _drillFips.has(featureState(f)))
      : geo.features;
    const fc = { type: 'FeatureCollection', features: stateFeatures };

    const countyMetricFor = (c) => {
      if (!c) return null;
      if (metricKey === 'service')    return reportingDomService(c.rows);
      if (metricKey === 'acv')        return c.avgContract;
      if (metricKey === 'revenue')    return c.arv;
      if (metricKey === 'customers')  return c.customers;
      if (metricKey === 'subs')       return c.subs;
      if (metricKey === 'attrition')  return c.attritionEligible ? c.cancelRate : null;
      if (metricKey === 'retention')  return c.attritionEligible ? (1 - c.cancelRate) : null;
      return 0;
    };
    const colorFor = metricKey === 'service'
      ? (name) => (svcColorMap && svcColorMap.get(name)) || REPORTING_SVC_OTHER
      : reportingQuantileScale(countiesInState.map(countyMetricFor), metricKey);

    let highlightedPolygon = null;
    const normalizedTarget = highlightCounty ? reportingNormCounty(highlightCounty) : null;

    const layer = L.geoJSON(fc, {
      style: (feature) => {
        const c = byCounty.get(_cKey(featureState(feature), feature.properties.NAME));
        const isHighlight = normalizedTarget && reportingNormCounty(feature.properties.NAME) === normalizedTarget;
        const v = countyMetricFor(c);
        return {
          fillColor: colorFor(v),
          fillOpacity: isHighlight ? 0.95 : (c ? 0.85 : 0.15),
          color: isHighlight ? '#DC2626' : '#7C857A',
          weight: isHighlight ? 3 : 0.4,
        };
      },
      onEachFeature: (feature, layerObj) => {
        const name = feature.properties.NAME || 'County';
        const norm = reportingNormCounty(name);
        const c = byCounty.get(_cKey(featureState(feature), name));
        const isHighlight = normalizedTarget && norm === normalizedTarget;
        if (isHighlight) highlightedPolygon = layerObj;
        if (!c) {
          layerObj.bindTooltip('<b>' + name + ' County</b><br><i>No data in current filter</i>', { sticky: true });
          return;
        }
        const v = countyMetricFor(c);
        const display = v == null ? '< 10 subs' : fmtMetric(v);
        const tooltipHtml = '<b>' + name + ' County</b><br>'
          + metricLabel + ': ' + display + '<br>'
          + c.subs + ' subs · ' + c.customers + ' customers';
        layerObj.bindTooltip(tooltipHtml, { sticky: true });
        layerObj.on('click', () => onCountyClick(c));
        layerObj.on('mouseover', (e) => {
          if (!isHighlight) e.target.setStyle({ weight: 2, color: '#323230' });
        });
        layerObj.on('mouseout',  (e) => {
          if (!isHighlight) e.target.setStyle({ weight: 0.4, color: '#7C857A' });
        });
      },
    }).addTo(map);
    if (highlightedPolygon) {
      try {
        map.fitBounds(highlightedPolygon.getBounds(), { padding: [60, 60], maxZoom: 11 });
        highlightedPolygon.bringToFront();
        highlightedPolygon.openTooltip();
      } catch {}
    } else {
      try { map.fitBounds(layer.getBounds(), { padding: [20, 20] }); } catch {}
    }

    // Same zip-based service boundary, overlaid on the county view. Needs the
    // ZIP geometry (counties don't carry it), so we pull the state's ZIP geo.
    if (serviceZips && serviceZips.size) {
      const _bStates = [..._drillFips.size ? new Set(countiesInState.map(c => c.state)) : new Set([stateCode])].filter(s => REPORTING_STATE_CODE_TO_NAME[s]);
      Promise.all(_bStates.map(loadReportingZipGeo)).then(_zps => {
        const _zf = [];
        _zps.forEach(g => { if (g && g.features) _zf.push(...g.features); });
        if (_zf.length) drawReportingServiceBoundary(map, { type: 'FeatureCollection', features: _zf }, serviceZips);
      });
    }
  });
}

// Lazy-load US state boundaries GeoJSON from a public CDN. Cached on the
// window so subsequent renders don't re-fetch. Returns null on failure
// so the map can fall back to "data unavailable" messaging.
async function loadReportingStatesGeo() {
  if (window._reportingStatesGeo) return window._reportingStatesGeo;
  try {
    const res = await fetch('https://cdn.jsdelivr.net/gh/PublicaMundi/MappingAPI@master/data/geojson/us-states.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const geo = await res.json();
    window._reportingStatesGeo = geo;
    return geo;
  } catch (e) {
    console.warn('[ridd] state GeoJSON load failed', e);
    return null;
  }
}

// Aggregate scope rows into per-state and per-zip records. Both are
// computed in one pass so the metric toggle can switch instantly without
// recomputing the raw aggregates.
// Service-area definitions by office — the ZIPs each branch services. Drawn as
// a red boundary on the Geographic ZIP map (dissolved + island-pruned client
// side). Refine in the standalone tool (geo/atlanta_service_area.html) and
// paste the exported ZIP list here per branch.
const RIDD_SERVICE_AREAS = {
  // ZIP service-area boundaries per office. Built from customer density (2+
  // customers) and pruned to counties with a real footprint so stray out-of-
  // area customers (e.g. a lone Columbia account) don't draw a phantom blob.
  // Refine edge ZIPs against the drawn service-area screenshots as needed.
  'Salt Lake': ['84003','84004','84005','84006','84009','84010','84013','84014','84015','84020','84025','84037','84040','84041','84042','84043','84044','84045','84047','84054','84057','84058','84059','84062','84065','84067','84070','84075','84081','84084','84087','84088','84092','84093','84094','84095','84096','84097','84102','84104','84105','84106','84107','84108','84109','84115','84116','84117','84118','84119','84120','84121','84123','84124','84128','84129','84315','84317','84401','84403','84404','84405','84414','84601','84604','84606','84651','84653','84655','84663','84664'],
  'Charleston': ['29112','29401','29403','29405','29406','29407','29410','29412','29414','29418','29420','29429','29431','29436','29439','29445','29446','29449','29450','29451','29455','29456','29458','29461','29464','29466','29470','29472','29479','29483','29485','29486','29487','29488','29492','29902','29906','29907','29909','29910','29920','29926','29927','29935','29936','29940','29945','31302','31308','31312','31322','31324','31326','31329','31401','31404','31405','31406','31407','31408','31410','31415','31419'],
  'Myrtle Beach': ['28401','28403','28405','28409','28411','28412','28420','28422','28425','28428','28429','28436','28443','28445','28450','28451','28452','28456','28457','28460','28461','28462','28463','28465','28467','28468','28469','28470','28472','28479','28540','28546','28574','29161','29440','29501','29505','29506','29511','29526','29527','29530','29532','29536','29540','29541','29544','29560','29565','29566','29568','29569','29571','29572','29574','29575','29576','29577','29578','29579','29581','29582','29585','29588'],
  'Raleigh': ['27278','27467','27501','27502','27504','27509','27511','27513','27514','27516','27517','27518','27519','27520','27521','27522','27523','27524','27525','27526','27527','27529','27539','27540','27542','27545','27546','27549','27557','27560','27562','27565','27571','27576','27577','27581','27587','27591','27592','27596','27597','27601','27603','27604','27605','27606','27607','27608','27609','27610','27612','27613','27614','27615','27616','27617','27627','27701','27703','27704','27705','27707','27712','27713','27801','27803','27804','27807','27809','27822','27851','27856','27880','27882','27893','27896','28323','28334'],
  'Destin': ['32250','32401','32404','32405','32407','32408','32409','32413','32428','32433','32435','32439','32444','32451','32459','32461','32466','32501','32502','32503','32504','32505','32506','32507','32514','32526','32531','32533','32534','32536','32539','32541','32547','32548','32549','32550','32561','32563','32565','32566','32567','32569','32570','32571','32578','32579','32580','32583','32939'],
  'Virginia Beach': ['23005','23059','23060','23111','23112','23113','23114','23116','23150','23168','23185','23188','23227','23228','23229','23230','23231','23234','23235','23236','23237','23294','23314','23320','23321','23322','23323','23324','23325','23426','23430','23432','23433','23434','23435','23436','23437','23451','23452','23453','23454','23455','23456','23457','23462','23464','23487','23502','23503','23504','23505','23507','23508','23509','23513','23517','23518','23523','23601','23602','23603','23605','23606','23607','23608','23661','23662','23663','23664','23666','23669','23690','23692','23693','23696','23701','23702','23703','23704','23707','23803','23805','23831','23832','23834','23836','23838','23842','23860','23875'],
  'Detroit': ['48009','48017','48025','48026','48033','48034','48035','48038','48042','48044','48045','48066','48067','48071','48072','48073','48075','48076','48081','48082','48083','48085','48088','48089','48092','48093','48111','48114','48116','48127','48135','48141','48150','48152','48154','48167','48170','48178','48184','48185','48186','48187','48188','48189','48198','48201','48205','48210','48213','48219','48223','48224','48227','48228','48234','48235','48237','48238','48239','48240','48310','48331','48334','48335','48336','48374','48375','48380','48381','48390','48393','48843','48855'],
  'Atlanta': ['30004','30008','30009','30011','30014','30016','30017','30019','30022','30024','30025','30028','30030','30032','30033','30034','30035','30038','30039','30040','30041','30043','30044','30045','30046','30047','30052','30054','30058','30060','30062','30064','30066','30067','30068','30075','30076','30078','30080','30082','30083','30084','30087','30088','30092','30093','30096','30097','30101','30102','30103','30104','30106','30107','30108','30110','30114','30115','30116','30117','30120','30121','30122','30126','30127','30132','30134','30135','30137','30141','30143','30144','30145','30152','30153','30157','30168','30171','30178','30179','30180','30183','30184','30185','30187','30188','30189','30213','30238','30268','30273','30274','30281','30291','30294','30296','30305','30306','30307','30308','30309','30310','30311','30314','30315','30316','30317','30318','30319','30324','30326','30327','30328','30329','30331','30336','30337','30338','30339','30342','30344','30345','30349','30350','30354','30360','30501','30504','30506','30507','30517','30518','30519','30542','30543','30548','30549','30554','30566','30567','30575','30620','30641','30655','30656','30666','30680','33619'],
};

// Most common service among a set of subscription rows — drives the
// "Top Service" categorical map metric.
function reportingDomService(rows) {
  if (!rows || !rows.length) return null;
  const c = {}; let best = null, bn = 0;
  for (const r of rows) { const s = r.subscription || 'Unknown'; c[s] = (c[s] || 0) + 1; if (c[s] > bn) { bn = c[s]; best = s; } }
  return best;
}
const REPORTING_SVC_OTHER = '#9aa0a6';

// Service-type breakdown for a set of rows → [[name, count], ...] desc.
function reportingServiceBreakdown(rows) {
  const c = new Map();
  for (const r of (rows || [])) { const s = r.subscription || 'Unknown'; c.set(s, (c.get(s) || 0) + 1); }
  return [...c.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}
// Service Types popup — top 10 service types in a ZIP (or county) with counts.
function openReportingServicesModal(area, label) {
  const breakdown = reportingServiceBreakdown(area.rows);
  const total = breakdown.reduce((s, [, n]) => s + n, 0);
  const top = breakdown.slice(0, 10);
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', key); };
  const key = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', key);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card w-full max-w-lg my-8 overflow-hidden flex flex-col', style: { maxHeight: 'calc(100vh - 64px)' } },
    el('div', { class: 'flex items-start justify-between p-5 pb-3' },
      el('div', {},
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Top Service Types'),
        el('h2', { class: 'text-xl font-bold mt-0.5' }, label),
        el('div', { class: 'text-xs text-muted- mt-1' },
          breakdown.length.toLocaleString() + ' distinct service types · ' + total.toLocaleString() + ' subs'),
      ),
      el('button', { class: 'text-2xl leading-none', style: { color: 'var(--text-muted)' }, onclick: close }, '×'),
    ),
    el('div', { class: 'overflow-auto px-5 pb-5 flex flex-col gap-2', style: { borderTop: '1px solid var(--border)' } },
      ...top.map(([name, n], i) => {
        const pct = total ? (n / total) * 100 : 0;
        return el('div', { class: 'flex items-center gap-3 text-xs pt-2' },
          el('div', { class: 'w-5 text-right tabular-nums font-bold', style: { color: 'var(--text-subtle)' } }, String(i + 1)),
          el('div', { class: 'flex-1 min-w-0' },
            el('div', { class: 'flex items-center justify-between gap-2' },
              el('div', { class: 'truncate font-medium', title: name }, name),
              el('div', { class: 'tabular-nums font-semibold whitespace-nowrap' }, n.toLocaleString() + ' · ' + pct.toFixed(1) + '%'),
            ),
            el('div', { class: 'h-2 rounded-full mt-1 overflow-hidden', style: { background: 'var(--border)' } },
              el('div', { style: { width: pct.toFixed(1) + '%', height: '100%', background: 'var(--accent)', borderRadius: '0' } })),
          ),
        );
      }),
    ),
  );
  overlay.append(card);
  document.body.append(overlay);
}

// Roll a set of finalized geo buckets (ZIPs / counties / offices / states)
// into one RIDD total — sums for counts and dollars, sub- or customer-
// weighted for the rates — for the 𝕽 row pinned atop each table.
function reportingGeoTotal(items) {
  const t = { customers: 0, subs: 0, active: 0, contract: 0, arv: 0, cancellations: 0, tenureW: 0, twoYrW: 0, sentW: 0, ltvW: 0 };
  for (const it of items || []) {
    t.customers += it.customers || 0; t.subs += it.subs || 0; t.active += it.active || 0;
    t.contract += it.contract || 0; t.arv += it.arv || 0; t.cancellations += it.cancellations || 0;
    t.tenureW += (it.avgTenure || 0) * (it.subs || 0); t.twoYrW += (it.twoYrPct || 0) * (it.subs || 0);
    t.sentW += (it.sentriconPct || 0) * (it.customers || 0); t.ltvW += (it.ltv || 0) * (it.customers || 0);
  }
  return {
    name: 'RIDD', customers: t.customers, subs: t.subs, active: t.active, contract: t.contract, arv: t.arv, cancellations: t.cancellations,
    avgContract: t.subs ? t.contract / t.subs : 0, cancelRate: t.subs ? t.cancellations / t.subs : 0,
    avgTenure: t.subs ? t.tenureW / t.subs : 0, twoYrPct: t.subs ? t.twoYrW / t.subs : 0,
    sentriconPct: t.customers ? t.sentW / t.customers : 0, ltv: t.customers ? t.ltvW / t.customers : 0,
    attritionEligible: t.subs >= 10, rows: [],
  };
}
function reportingGeoAggregate(rows, F) {
  const ATTRITION_MIN_SUBS = 10;
  // Overview's own predicates (recurring / active / real cancel incl. the
  // excluded reasons + 3-day ROR rule) so every number here ties to the
  // Overview cards. Fallback keeps the old behaviour if called without F.
  F = F || reportingFilters();

  const seed = () => ({
    subs: 0,
    customers: new Set(),
    contract: 0,
    arv: 0,
    cancellations: 0,
    active: 0,
    // LTV / stickiness (per Isaac): months each sub has been on the books
    // (first service → cancel date, or → today while still active), the
    // recurring dollars that tenure earned (ARV ÷ 12 × months), and how
    // many subs have made it past two years.
    tenureMo: 0, tenureN: 0, ltvRev: 0, twoYr: 0,
    sentricon: new Set(),   // distinct customers with a Sentricon plan (per Isaac)
    rows: [],
    state: null,
  });
  const _today = Date.now();
  const _tenureMonths = (r) => {
    const s0 = r.origin_initial_service || r.initial_service || r.origin_sold_date || r.sold_date; if (!s0) return null;
    const a = new Date(String(s0).slice(0, 10) + 'T00:00'); if (isNaN(a)) return null;
    const b = r.subscription_date_canceled ? new Date(String(r.subscription_date_canceled).slice(0, 10) + 'T00:00') : new Date(_today);
    const mo = (b - a) / (86400000 * 30.4375);
    return mo > 0 ? mo : 0;
  };

  const byState = new Map();
  const byOffice = new Map();   // branch → same bucket shape (for the Office breakdown)
  // ZIP buckets are keyed on state+zip so two customers in different
  // states that share a zip code (or both have an empty zip that would
  // collapse to 'Unknown') don't get merged into a single bucket where
  // the first state wins.
  const byZip   = new Map();
  // County buckets are likewise keyed on state+county — county names are
  // not unique across states (every state has a Washington County).
  const byCounty = new Map();
  for (const r of rows) {
    const st     = r.state    || 'Unknown';
    const zip    = r.zip_code || 'Unknown';
    const county = r.county   || 'Unknown';
    const zipKey    = st + '|' + zip;
    const countyKey = st + '|' + county;
    const offName = (r.office_name || 'Unknown').trim() || 'Unknown';
    if (!byState.has(st))           byState.set(st, seed());
    if (!byOffice.has(offName))     byOffice.set(offName, seed());
    if (!byZip.has(zipKey))         byZip.set(zipKey, seed());
    if (!byCounty.has(countyKey))   byCounty.set(countyKey, seed());
    for (const m of [byState.get(st), byOffice.get(offName), byZip.get(zipKey), byCounty.get(countyKey)]) {
      m.subs += 1;
      if (r.customer_id) m.customers.add(r.customer_id);
      m.contract += Number(r.subscription_contract_value) || 0;
      const _act = F.isActive(r);
      // ARV counts ACTIVE subs only — the same "Active ARR" the Overview
      // shows. (It used to sum cancelled subs' ARV too, which is why the
      // office total read $66M against the Overview's $39M.)
      if (_act) { m.active += 1; m.arv += Number(r.annual_recurring_value) || 0; }
      if (F.isRealCancel(r)) m.cancellations += 1;
      const _tm = _tenureMonths(r);
      if (_tm != null) { m.tenureMo += _tm; m.tenureN += 1; m.ltvRev += (Number(r.annual_recurring_value) || 0) / 12 * _tm; if (_tm >= 24) m.twoYr += 1; }
      if (r.customer_id && /sentricon/i.test(String(r.subscription || ''))) m.sentricon.add(r.customer_id);
      m.rows.push(r);
    }
    // Stamp the bucket's display state + zip on first sight (constant
    // across all members of the bucket).
    const zb = byZip.get(zipKey);
    if (!zb.state) zb.state = st;
    if (!zb.zip)   zb.zip = zip;
    const cb = byCounty.get(countyKey);
    if (!cb.state)  cb.state = st;
    if (!cb.county) cb.county = county;
  }

  const finalize = (m) => ({
    subs: m.subs,
    customers: m.customers.size,
    contract: m.contract,
    arv: m.arv,
    cancellations: m.cancellations,
    active: m.active,
    avgContract: m.subs > 0 ? m.contract / m.subs : 0,
    cancelRate:  m.subs > 0 ? m.cancellations / m.subs : 0,
    // Office this area belongs to = the branch that services most of its subs.
    office: (() => { const c = new Map(); for (const r of m.rows) { const o = r.office_name; if (o) c.set(o, (c.get(o) || 0) + 1); } return [...c.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || ''; })(),
    avgTenure:   m.tenureN > 0 ? m.tenureMo / m.tenureN : 0,          // months
    ltv:         m.customers.size > 0 ? m.ltvRev / m.customers.size : 0, // realized recurring $ per customer
    twoYrPct:    m.tenureN > 0 ? m.twoYr / m.tenureN : 0,
    sentriconPct: m.customers.size > 0 ? m.sentricon.size / m.customers.size : 0,   // share of customers with a Sentricon plan
    rows: m.rows,
  });

  const states = {};
  for (const [k, v] of byState.entries()) states[k] = finalize(v);
  const offices = {};
  for (const [k, v] of byOffice.entries()) offices[k] = finalize(v);

  const zips = [];
  for (const m of byZip.values()) {
    const f = finalize(m);
    // m.zip is the original CSV zip_code value (or 'Unknown' fallback)
    // — NOT the state|zip bucket key we built above for grouping.
    zips.push({ zip: m.zip, state: m.state, ...f, attritionEligible: f.subs >= ATTRITION_MIN_SUBS });
  }

  const counties = [];
  for (const m of byCounty.values()) {
    const f = finalize(m);
    counties.push({ county: m.county, state: m.state, ...f, attritionEligible: f.subs >= ATTRITION_MIN_SUBS });
  }

  return { states, offices, zips, counties, attritionMinSubs: ATTRITION_MIN_SUBS };
}

// Build a 5-bin quantile color scale that's resilient to outliers.
//
// Linear v/max scaling is fragile: one dominant state (or one giant ZIP)
// pushes everyone else to the lightest color and you lose the spread.
// Here we:
//   1. Cap the scale at the 95th percentile of non-zero values so a few
//      extreme outliers don't compress the rest of the data.
//   2. Bin values into 5 equal-population buckets WITHIN that capped
//      range, giving each tier a distinct color step.
//
// Returns a function value → CSS color. Attrition gets a red palette
// (higher = worse); other metrics get the brand green (higher = more
// activity).
function reportingQuantileScale(values, metricKey) {
  const NO_DATA = '#F3F4F6';
  const palette = metricKey === 'attrition'
    ? ['rgba(220,38,38,0.18)', 'rgba(220,38,38,0.36)', 'rgba(220,38,38,0.56)', 'rgba(220,38,38,0.76)', 'rgba(220,38,38,0.95)']
    : ['rgba(223,100,58,0.22)', 'rgba(223,100,58,0.42)', 'rgba(223,100,58,0.62)', 'rgba(223,100,58,0.80)', 'rgba(223,100,58,0.95)'];

  const sorted = (values || [])
    .filter(v => v != null && Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);

  if (sorted.length === 0) return (v) => NO_DATA;

  // p95 cap: largest value at or below the 95th percentile. With fewer
  // than 20 data points, just use the actual max so we don't pretend
  // there's outlier-clipping happening when there isn't.
  const cap = sorted.length >= 20
    ? sorted[Math.floor(sorted.length * 0.95)]
    : sorted[sorted.length - 1];

  // Quintile boundaries computed across the in-range subset only.
  const inRange = sorted.filter(v => v <= cap);
  const N = 5;
  const thresholds = [];
  for (let i = 1; i < N; i++) {
    const idx = Math.min(inRange.length - 1, Math.floor(inRange.length * (i / N)));
    thresholds.push(inRange[idx]);
  }

  return (v) => {
    if (v == null || !Number.isFinite(v) || v <= 0) return NO_DATA;
    if (v >= cap) return palette[N - 1]; // outliers all share the top color
    for (let i = 0; i < thresholds.length; i++) {
      if (v <= thresholds[i]) return palette[i];
    }
    return palette[N - 1];
  };
}

// Render the Leaflet choropleth into the given container. Destroys any
// previous instance so the map re-paints cleanly when the metric or
// scope changes.
function initReportingGeoMap(containerId, states, metricKey, metricLabel, fmtMetric, onStateClick, svcColorMap) {
  if (typeof L === 'undefined') return; // Leaflet still loading; we'll re-init on next render
  const container = document.getElementById(containerId);
  if (!container) return;

  // Tear down any prior map instance bound to this DOM element. Leaflet
  // hangs on to the container otherwise and the next init throws.
  if (container._leafletMap) {
    try { container._leafletMap.remove(); } catch {}
    container._leafletMap = null;
  }

  const map = L.map(container, {
    center: [37.8, -96],
    zoom: 4,
    zoomControl: true,
    scrollWheelZoom: false, // avoid hijacking page scroll
  });
  container._leafletMap = map;

  // Basemap: Esri Light Gray Canvas — same quiet look as the old CARTO light
  // tiles, free with attribution and NO API key (CARTO gates its basemaps now).
  L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles \u00a9 Esri \u2014 Esri, HERE, Garmin, \u00a9 OpenStreetMap contributors',
    maxZoom: 10,
  }).addTo(map);
  setTimeout(() => { try { map.invalidateSize(); } catch (e) { /* torn down */ } }, 400);

  loadReportingStatesGeo().then(geo => {
    if (!geo) return;

    // Quintile color scale across every state's metric value. The scale
    // caps at the 95th percentile so a single outlier state doesn't
    // wash out the spread for everyone else.
    const metricFor = (s) => {
      if (!s) return null;
      if (metricKey === 'service')    return reportingDomService(s.rows);
      if (metricKey === 'acv')        return s.avgContract;
      if (metricKey === 'revenue')    return s.arv;
      if (metricKey === 'customers')  return s.customers;
      if (metricKey === 'subs')       return s.subs;
      if (metricKey === 'attrition')  return s.subs >= 10 ? s.cancelRate : null;
      if (metricKey === 'retention')  return s.subs >= 10 ? (1 - s.cancelRate) : null;
      return 0;
    };
    const allValues = Object.keys(states).map(code => metricFor(states[code]));
    const colorFor = metricKey === 'service'
      ? (name) => (svcColorMap && svcColorMap.get(name)) || REPORTING_SVC_OTHER
      : reportingQuantileScale(allValues, metricKey);

    L.geoJSON(geo, {
      style: (feature) => {
        const name = feature.properties.name;
        const code = REPORTING_STATE_NAME_TO_CODE[name];
        const s = code ? states[code] : null;
        const v = metricFor(s);
        return {
          fillColor: colorFor(v),
          fillOpacity: 0.85,
          color: '#7C857A',
          weight: 0.8,
        };
      },
      onEachFeature: (feature, layer) => {
        const name = feature.properties.name;
        const code = REPORTING_STATE_NAME_TO_CODE[name];
        const s = code ? states[code] : null;
        const v = metricFor(s);
        const display = v == null ? 'No data' : fmtMetric(v);
        const subsLine = s ? '<br>' + s.subs.toLocaleString() + ' subs · ' + s.customers.toLocaleString() + ' customers' : '';
        layer.bindTooltip('<b>' + name + '</b><br>' + metricLabel + ': ' + display + subsLine, { sticky: true });
        layer.on('click', () => {
          if (s && onStateClick) onStateClick(code, name);
        });
        layer.on('mouseover', (e) => e.target.setStyle({ weight: 2, color: '#323230' }));
        layer.on('mouseout',  (e) => e.target.setStyle({ weight: 0.8, color: '#7C857A' }));
      },
    }).addTo(map);
  });
}

// Export the current Geographic breakdown as a CSV — the rows match exactly
// what the breakdown table shows (active office/date filter + sort order),
// so at the default country view this is the full company-wide list of ZIPs
// with an account count per ZIP, ready to hand to a lead provider. `kind` is
// 'zip' | 'county'; `scopeTag` labels the file ('all' at country level, the
// state code when drilled in).
function exportReportingGeoCsv(items, kind, scopeTag) {
  if (!items || !items.length) { toast('Nothing to export', 'warn'); return; }
  const firstCol = kind === 'county' ? 'county' : 'zip';
  const headers = [firstCol, 'state', 'offices', 'accounts', 'subscriptions', 'avg_contract_value', 'active_arr', 'active_subscriptions', 'cancellations', 'attrition_pct', 'avg_tenure_months', 'two_year_plus_pct', 'sentricon_customer_pct', 'ltv_per_customer'];
  const lines = [headers.join(',')];
  for (const it of items) {
    // Distinct office names contributing to this ZIP/county, in volume order.
    const offCounts = new Map();
    for (const r of (it.rows || [])) {
      const o = r.office_name; if (!o) continue;
      offCounts.set(o, (offCounts.get(o) || 0) + 1);
    }
    const offices = [...offCounts.entries()].sort((a, b) => b[1] - a[1]).map(([o]) => o).join('; ');
    lines.push([
      csvEsc(kind === 'county' ? (it.county || 'Unknown') : it.zip),
      csvEsc(it.state || ''),
      csvEsc(offices),
      it.customers,
      it.subs,
      Math.round(it.avgContract),
      Math.round(it.arv),
      it.active,
      it.cancellations,
      // Mirror the table: attrition is only meaningful with 10+ subs, so
      // leave it blank below the floor rather than print a noisy rate.
      it.attritionEligible ? (it.cancelRate * 100).toFixed(1) : '',
      (it.avgTenure || 0).toFixed(1),
      Math.round((it.twoYrPct || 0) * 100),
      Math.round((it.sentriconPct || 0) * 100),
      Math.round(it.ltv || 0),
    ].join(','));
  }
  const blob = new Blob([lines.join('\n')], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const date = new Date().toISOString().slice(0, 10);
  const a = el('a', { href: url, download: 'ridd-accounts-by-' + firstCol + '-' + scopeTag + '-' + date + '.csv' });
  document.body.append(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
  toast('Exported ' + items.length.toLocaleString() + ' ' + (kind === 'county' ? 'counties' : 'ZIPs'), 'success');
}

