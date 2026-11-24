// ┌─ reporting/market-watch.js ────────────────────────────────────────────────
// │ Reporting → Market Watch (per Isaac, Nov 24 2026): what the public pest
// │ control companies are reporting, next to RIDD's own numbers.
// │ PUBLIC FIGURES ONLY, each from a filing or results release — the link sits
// │ beside every block (MARKET_WATCH.sources). Nothing here is estimated: a
// │ figure a company does not publish reads "not published". Items tagged
// │ `call` come from the earnings-call transcript and are paraphrased.
// │ RIDD's side is computed live from the app's own rules:
// │   · book growth  = (new recurring ARR serviced − recurring ARR cancelled,
// │     last 365 days) ÷ the book a year ago — the Overview scorecard's rule
// │   · retention    = 1 − the Retention tab's trailing-12-month attrition
// │ RIDD's P&L lines (gross margin, selling % of revenue …) are NOT mapped
// │ here yet — they need a line-by-line match to the QuickBooks chart first.
// │ Refresh: update MARKET_WATCH each quarter when Rollins / Rentokil report.
// └──────────────────────────────────────────────────────────────────────────
const MARKET_WATCH = {
  asOf: '2026-11-24',
  sources: {
    rolQ3: ['Rollins Q3 2026 results release (Oct 21 2026)', 'https://www.morningstar.com/news/pr-newswire/20261021cl77936/rollins-inc-reports-third-quarter-2026-financial-results'],
    rolCall: ['Rollins Q3 2026 earnings call transcript (Oct 22 2026)', 'https://www.fool.com/earnings/call-transcripts/2026/10/22/rollins-rol-q3-2026-earnings-call-transcript/'],
    rolFy: ['Rollins Q4 and full-year 2025 results release', 'https://www.rollins.com/investors/press-releases/detail/426/rollins-inc-reports-fourth-quarter-and-full-year-2025-financial-results'],
    rol10k: ['Rollins 2025 Form 10-K (filed Feb 12 2026)', 'https://www.rollins.com/investors/financial-information/sec-filings/content/0000084839-26-000008/rol-20251231.htm'],
    rtoH1: ['Rentokil Initial 2026 interim results (Jul 30 2026)', 'https://www.rentokil-initial.com/~/media/Files/R/Rentokil/documents/2026-interim-result-statement.pdf'],
  },
  // Rollins, Q3 2026 vs Q3 2025 and nine months — results release tables.
  rollinsQuarter: {
    label: 'Rollins (ROL) · Q3 2026', src: 'rolQ3',
    rows: [
      ['Revenue', '$1,089.7M', '+6.2%', '$3,074.7M', '+8.0%'],
      ['Organic revenue growth', '+4.4%', '', '+5.5%', ''],
      ['Residential · organic', '+2.3%', '', '+3.3%', ''],
      ['Commercial · organic', '+6.6%', '', '+7.1%', ''],
      ['Termite & ancillary · organic', '+5.3%', '', '+7.9%', ''],
      ['Gross margin', '53.5%', '−90 bps', '52.5%', '−80 bps'],
      ['SG&A % of revenue', '30.0%', '+60 bps', '30.7%', '+50 bps'],
      ['Selling & marketing % of revenue', '13.4%', '−10 bps', '13.3%', '+10 bps'],
      ['Operating margin', '20.5%', '−140 bps', '18.5%', '−140 bps'],
      ['Adjusted EBITDA margin', '23.5%', '−170 bps', '21.9%', '−130 bps'],
      ['Net income', '$157.9M', '−3.4%', '$409.7M', '−0.1%'],
      ['Free cash flow', '$235.5M', '+28.8%', '$512.8M', '+4.4%'],
      ['Acquisitions (cash, net)', '$27.4M', '', '$162.6M', ''],
    ],
  },
  // Rollins full-year 2025 cost structure, % of revenue — FY2025 results release table.
  rollinsCosts: {
    label: 'Rollins · full-year 2025 cost structure (% of revenue)', src: 'rolFy', revenue: '$3,761.1M · +11.0% (organic +6.9%)',
    rows: [
      ['Cost of services', '47.2%', true], ['· Service employee expenses', '31.0%'], ['· Materials & supplies', '6.0%'], ['· Fleet', '4.2%'], ['· Insurance & claims', '1.8%'], ['· Other', '4.3%'],
      ['Gross margin', '52.8%', true],
      ['SG&A', '30.1%', true], ['· Selling & marketing', '12.9%'], ['· Administrative employees', '9.2%'], ['· Insurance & claims', '1.1%'], ['· Fleet', '1.1%'], ['· Other', '5.9%'],
      ['Depreciation & amortization', '3.3%'], ['Operating margin', '19.3%', true], ['Adjusted EBITDA margin', '22.7%', true], ['Net income margin', '14.0%', true],
    ],
    facts: ['Recurring services about 75% of the business, ancillary 10%, one-time 15% (10-K)', '21,946 employees at year-end 2025 (10-K)', '26 acquisitions in 2025; $310M cash invested (10-K / release)'],
    factsSrc: 'rol10k',
  },
  rentokil: {
    label: 'Rentokil Initial · North America · H1 2026', src: 'rtoH1',
    rows: [
      ['North America revenue', '$2,197M', '+4.3%'], ['Organic revenue growth', '+3.7%', 'Q1 3.9% · Q2 3.6%'], ['Pest Control Services · organic', '+2.6%', 'contract 2.6% · jobbing 5.7%'],
      ['Adjusted operating margin', '17.9%', '+1.0 pts'], ['Customer retention', '80.7%', 'H1 2025: 80.5%'], ['Colleague retention', '82.7%', 'H1 2025: 80.7%'], ['Residential lead flow', '+6%', 'weakened late Q2 into July'],
    ],
  },
  // What management said — paraphrased. [text, source key]
  saying: [
    ['Rollins called Q3 a disappointment: residential organic growth slowed to 2.3% while commercial held at 6.6%.', 'rolQ3'],
    ['The cause they name is customer discovery, not demand: AI and LLM search is changing how people find a provider, and digital lead flow weakened further from Q2.', 'rolCall'],
    ['Their response: more local content and listings, pricing shown up front, same-day / next-day availability, spend moved to higher-return channels, and paid ads on ChatGPT and Google Gemini. They said leads have not stabilized yet.', 'rolCall'],
    ['Full-year 2026 organic growth outlook cut to 4%–6% (from about 6% at Q2); acquisitions add 2%–3%.', 'rolCall'],
    ['Margins fell mostly on insurance and claims (about 100 bps of gross margin) and fleet costs; selling and marketing stayed near 13.4% of revenue.', 'rolCall'],
    ['They describe the recurring residential base as healthy, with customer count up and retention strong — no retention figure is published.', 'rolCall'],
    ['Rentokil (Terminix) North America grew 3.7% organically in H1 with customer retention of 80.7%; it has opened about 220 small local branches and added lead co-ordinators to speed up scheduling. Its residential lead flow also weakened into July.', 'rtoH1'],
  ],
  // From the call transcript, not from a results table — worth knowing, check the transcript before quoting.
  callNotes: [
    'Door-to-door brands (Fox, HomeTeam) outperformed; door-to-door grew double digits.',
    'Price realization of about 3%–4% across the portfolio, weighted to commercial.',
    'Organic website traffic down 13% year over year in August and 4% in September.',
    'Long-term targets restated: 7%–8% organic growth and 30%–35% incremental margins.',
  ],
};

// RIDD's own comparable numbers — live, same rules as Overview and Retention.
function marketWatchRidd() {
  const out = { growth: null, retention: null, book: null, net: null };
  try {
    const F = reportingFilters(), rows = F.visible || [];
    const recMap = typeof reportingServiceRecurringMap === 'function' ? reportingServiceRecurringMap() : new Map();
    const isRec = (r) => reportingRecurringMode() === 'arv' ? (Number(r.annual_recurring_value) || 0) > 0 : !!recMap.get(r.subscription);
    const isRen = (r) => typeof reportingSourceClass === 'function' && reportingSourceClass(reportingSourceOf(r)) === 'renewal';
    const now = new Date(), iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    const end = iso(now), st = (() => { const d = new Date(now); d.setDate(d.getDate() - 365); return iso(d); })();
    let book = 0, add = 0, cxl = 0;
    for (const r of rows) {
      const arr = Number(r.annual_recurring_value) || 0;
      const done = String(r.initial_status || '').toLowerCase() === 'completed' || !!r.initial_serviced_date;
      const sv = done ? String(r.initial_serviced_date || r.initial_service || r.sold_date || '').slice(0, 10) : '', cd = String(r.subscription_date_canceled || '').slice(0, 10);
      if (arr > 0 && sv && sv <= st && (!cd || cd > st)) book += arr;
      if (sv && sv > st && sv <= end && !isRen(r) && isRec(r)) add += arr;
      if (cd && cd > st && cd <= end && F.isRealCancel(r)) cxl += arr;
    }
    out.book = book; out.net = add - cxl; out.growth = book > 0 ? (add - cxl) / book : null;
  } catch (e) { /* data not loaded */ }
  try {
    const t = retenTrailing12(semRetentionBook(retenScopeSteps(_retenOfficeSlice('all')).out));
    if (t && t.boy > 0 && t.rate != null) out.retention = 1 - t.rate;
  } catch (e) { /* retention book not ready */ }
  return out;
}

function reportingMarketWatch() {
  const gate = typeof reportingDataGate === 'function' ? reportingDataGate() : null;
  const M = MARKET_WATCH, muted = { color: 'var(--text-muted)' };
  const R = gate ? { growth: null, retention: null } : refMemo('marketWatchRidd', [state.reportingSubscriptions, window._riddMutRev || 0, new Date().toDateString()], 300000, marketWatchRidd);
  const src = (k) => { const s = M.sources[k]; return s ? el('a', { href: s[1], target: '_blank', rel: 'noopener', class: 'text-[10px] underline', style: muted, title: s[0] }, 'Source: ' + s[0] + ' ↗') : null; };
  const th = (t, r) => el('th', { class: 'px-3 py-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (r ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, t);
  const td = (t, o = {}) => el('td', { class: 'px-3 py-1.5 whitespace-nowrap ' + (o.r ? 'text-right tabular-nums ' : '') + (o.b ? 'font-bold' : ''), style: { color: o.color } }, t);
  const card = (title, sub, ...kids) => el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 flex items-baseline gap-3 flex-wrap' }, el('h3', { class: 'text-base font-bold' }, title), sub ? el('span', { class: 'text-[11px]', style: muted }, sub) : null), ...kids);
  const pc = (v) => v == null || !isFinite(v) ? '—' : (v >= 0 ? '+' : '−') + Math.abs(v * 100).toFixed(1) + '%';
  const deltaColor = (t) => /^[+]/.test(t) ? '#15803D' : /^[−-]/.test(t) ? '#B91C1C' : undefined;

  // ── RIDD vs public ──
  const cmp = [
    ['Growth', 'Rollins organic revenue +4.4% (Q3) · +5.5% (9 mo); residential +2.3%', 'Rentokil N. America organic +3.7% (H1)', R.growth == null ? '—' : pc(R.growth) + ' book growth, last 12 mo',
      'RIDD’s figure is the change in the active recurring ARR book (new serviced minus cancelled, ÷ the book a year ago) — a recurring-book measure, not recognized revenue, and it includes door-to-door summer sales.'],
    ['Customer retention', 'Rollins: “strong”, no figure published', 'Rentokil N. America 80.7%', R.retention == null ? '—' : (R.retention * 100).toFixed(1) + '% (1 − trailing-12 attrition)',
      'RIDD’s is subscription-level from the Retention tab (counted cancels in the last 365 days ÷ subscriptions on the books a year ago). Rentokil’s is its own customer-retention definition, so read the gap as direction, not a like-for-like score.'],
    ['Revenue mix', 'Rollins: 75% recurring · 10% ancillary · 15% one-time', 'not published', 'not mapped yet', ''],
    ['Selling & marketing % of revenue', 'Rollins 13.4% (Q3) · 12.9% (FY25)', 'not published', 'needs the P&L mapping', 'Wages, incentives and ad spend sit on different QuickBooks lines at RIDD — worth mapping line by line before putting a number here.'],
    ['Gross margin', 'Rollins 53.5% (Q3) · 52.8% (FY25)', 'not published', 'needs the P&L mapping', ''],
    ['Operating margin', 'Rollins 20.5% (Q3) · 19.3% (FY25)', 'Rentokil N. America adjusted 17.9% (H1)', 'needs the P&L mapping', ''],
  ];
  const cmpCard = card('RIDD vs the public companies', 'Public figures as reported · RIDD live from the app',
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('Measure'), th('Rollins'), th('Rentokil (Terminix)'), th('RIDD'))),
      el('tbody', {}, ...cmp.map(([m, a, b, c, note]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' }, title: note || '' },
        td(m, { b: true }), el('td', { class: 'px-3 py-1.5' }, a), el('td', { class: 'px-3 py-1.5' }, b),
        el('td', { class: 'px-3 py-1.5 font-bold', style: { color: /needs|not mapped/.test(c) ? 'var(--text-subtle)' : 'var(--accent)' } }, c, note ? el('span', { class: 'ml-1', style: { color: 'var(--text-subtle)', cursor: 'help' } }, 'ⓘ') : null)))))),
    el('div', { class: 'px-5 py-2 text-[10px]', style: { color: 'var(--text-subtle)' } }, 'Definitions differ between companies — hover a RIDD number for how it is counted. RIDD P&L lines are left blank until they are matched to the QuickBooks chart of accounts.'));

  // ── What they're saying ──
  const sayCard = card('What they’re saying', 'Paraphrased from the latest results and calls',
    el('ul', { class: 'px-5 pb-3 flex flex-col gap-2 text-[13px]' }, ...M.saying.map(([t, k]) => el('li', { class: 'flex flex-col' }, el('span', {}, '• ' + t), el('span', { class: 'pl-3' }, src(k))))),
    el('div', { class: 'px-5 pb-4' },
      el('div', { class: 'text-[10px] uppercase tracking-widest font-bold mb-1', style: { color: 'var(--text-subtle)' } }, 'Also from the Rollins call (check the transcript before quoting)'),
      el('ul', { class: 'flex flex-col gap-1 text-[12px]', style: muted }, ...M.callNotes.map(t => el('li', {}, '• ' + t))), src('rolCall')));

  // ── Rollins quarter ──
  const Q = M.rollinsQuarter;
  const qCard = card(Q.label, 'vs the same period of 2025',
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th(''), th('Q3 2026', 1), th('vs Q3 2025', 1), th('9 months 2026', 1), th('vs 2025', 1))),
      el('tbody', {}, ...Q.rows.map(([n, a, b, c, d]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(n, { b: true }), td(a, { r: 1 }), td(b || '', { r: 1, color: deltaColor(b || '') }), td(c, { r: 1 }), td(d || '', { r: 1, color: deltaColor(d || '') })))))),
    el('div', { class: 'px-5 py-2' }, src(Q.src)));

  // ── Rollins cost structure ──
  const K = M.rollinsCosts;
  const kCard = card(K.label, 'Revenue ' + K.revenue,
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('tbody', {}, ...K.rows.map(([n, v, strong]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: strong ? 'var(--card-2)' : undefined } },
        td(n, { b: !!strong }),
        el('td', { class: 'px-3 py-1.5', style: { width: '45%' } }, el('div', { style: { height: '8px', borderRadius: '999px', background: 'var(--card-2)', overflow: 'hidden', border: strong ? '1px solid var(--border)' : '0' } }, el('div', { style: { width: Math.min(100, parseFloat(v)) + '%', height: '100%', background: strong ? '#2F5D62' : '#8F9A8C', borderRadius: '999px' } }))),
        td(v, { r: 1, b: !!strong })))))),
    el('ul', { class: 'px-5 py-2 text-[12px] flex flex-col gap-0.5', style: muted }, ...K.facts.map(t => el('li', {}, '• ' + t))),
    el('div', { class: 'px-5 pb-3 flex gap-4 flex-wrap' }, src(K.src), src(K.factsSrc)));

  // ── Rentokil ──
  const T = M.rentokil;
  const tCard = card(T.label, null,
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('tbody', {}, ...T.rows.map(([n, a, b]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(n, { b: true }), td(a, { r: 1, b: true }), el('td', { class: 'px-3 py-1.5', style: muted }, b || '')))))),
    el('div', { class: 'px-5 py-2' }, src(T.src)));

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'text-[11px]', style: muted }, 'Market Watch · public filings as of ' + new Date(M.asOf + 'T00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) + ' · Rollins next reports with Q4 and full-year 2026 results'),
    gate && !R.growth ? null : null,
    cmpCard, sayCard,
    el('div', { class: 'grid gap-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' } }, qCard, kCard),
    tCard);
}
