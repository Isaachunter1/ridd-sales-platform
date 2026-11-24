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
// │ RIDD's P&L lines (per Isaac, Nov 24 2026) come from the SAME QuickBooks
// │ grouping as the P&L tab (putisClassify / putisDerive), last 12 closed months:
// │   · Cost of services = COGS: Technician Labor Wages + Auto and Fuel +
// │     Chemicals and Job Supplies (+ Merchant Fees, which QuickBooks books
// │     under Other COGS; Rollins carries card fees in SG&A)
// │   · Selling & marketing = Advertising & Marketing + Selling Expenses
// │     (commissions) + Incentive Costs + Housing — every sales-related cost
// │   · G&A = every other operating expense group
// │   · EBITDA before selling costs = EBITDA + selling & marketing above
// │     (Isaac's adjusted EBITDA: adds back all sales-related expense, housing
// │     and door-to-door commissions included)
// │ Admin only. A Developer never sees these lines (no sample numbers either).
// │ Refresh: update MARKET_WATCH each quarter when Rollins / Rentokil report.
// └──────────────────────────────────────────────────────────────────────────
const MARKET_WATCH = {
  asOf: '2026-11-24',
  sources: {
    rolQ3: ['Rollins Q3 2026 results release (Oct 21 2026)', 'https://www.morningstar.com/news/pr-newswire/20261021cl77936/rollins-inc-reports-third-quarter-2026-financial-results'],
    rolCall: ['Rollins Q3 2026 earnings call transcript (Oct 22 2026)', 'https://www.fool.com/earnings/call-transcripts/2026/10/22/rollins-rol-q3-2026-earnings-call-transcript/'],
    rolFy: ['Rollins Q4 and full-year 2025 results release', 'https://www.rollins.com/investors/press-releases/detail/426/rollins-inc-reports-fourth-quarter-and-full-year-2025-financial-results'],
    rol10k: ['Rollins 2025 Form 10-K (filed Feb 12 2026)', 'https://www.rollins.com/investors/financial-information/sec-filings/content/0000084839-26-000008/rol-20251231.htm'],
    rolEvents: ['Rollins investor events page', 'https://www.rollins.com/investors/events-presentations'],
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
      // [Rollins line, Rollins %, strong, RIDD key (marketWatchPnl), what RIDD's number is made of]
      ['Cost of services', '47.2%', true, 'cogs', 'QuickBooks Cost of Goods Sold: tech wages + auto and fuel + chemicals and job supplies + merchant fees'],
      ['· Service employee expenses', '31.0%', false, 'tech', 'Technician Labor Wages'], ['· Materials & supplies', '6.0%', false, 'ms', 'Chemicals and Job Supplies'], ['· Fleet', '4.2%', false, 'auto', 'Auto and Fuel'],
      ['· Insurance & claims', '1.8%', false, null, 'RIDD books insurance under operating expenses, not cost of services'], ['· Other', '4.3%', false, 'merchant', 'Merchant Fees (Other COGS). Rollins carries card fees in SG&A.'],
      ['Gross margin', '52.8%', true, 'gp', 'Revenue minus the cost of services above'],
      ['SG&A', '30.1%', true, 'opex', 'All operating expenses: selling & marketing + G&A'],
      ['· Selling & marketing', '12.9%', false, 'selling', 'Advertising & Marketing + Selling Expenses (commissions) + Incentive Costs + Housing'],
      ['· Administrative employees', '9.2%', false, 'officeWages', 'Office Wages'], ['· Insurance & claims', '1.1%', false, 'insurance', 'Insurance'], ['· Fleet', '1.1%', false, null, 'RIDD books all auto and fuel in cost of services'],
      ['· Other', '5.9%', false, 'gaOther', 'Every other G&A group: rent, software, legal, travel, recruiting, office expenses …'],
      ['Depreciation & amortization', '3.3%', false, 'da', 'Depreciation and amortization as booked in QuickBooks'], ['Operating margin', '19.3%', true, 'op', 'EBITDA minus depreciation and amortization'],
      ['Adjusted EBITDA margin', '22.7%', true, 'ebitda', 'RIDD EBITDA: gross profit minus all operating expenses, before interest and depreciation'],
      ['Net income margin', '14.0%', true, null, 'Rollins is after corporate income tax; RIDD is not taxed the same way, so no like-for-like figure'],
      ['EBITDA before selling costs', 'not published', true, 'adj', 'RIDD adjusted EBITDA: EBITDA with every sales-related cost added back (marketing, commissions, incentives, housing). What the service business earns before growth spend.'],
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
  // Rollins, first nine months of 2026 (results release) — the benchmark RIDD's trailing-12 P&L is read against.
  // ebitda = adjusted EBITDA margin. rtoRetention = Rentokil North America customer retention, H1 2026 (Rollins publishes none).
  bench: { revGrowth: 0.080, organic: 0.055, residential: 0.033, gp: 0.525, selling: 0.133, sga: 0.307, ebitda: 0.219, rtoRetention: 0.807 },
  // Rollins has not announced the date (events page checked Nov 24 2026). Set `date` (YYYY-MM-DD) once it does.
  nextEarnings: { label: 'Q4 and full-year 2026', date: null, expected: 'Mid-February 2027', src: 'rolEvents',
    basis: 'Expected from the pattern: the last three fourth-quarter calls were Feb 12 2026, Feb 13 2025 and Feb 15 2024, 8:30 am ET.',
    last: 'Q3 2026, released Oct 21 2026 (call Oct 22).', also: 'Before then: Rollins presents at the Bernstein industrials forum on Dec 9 2026.' },
  // Top-of-mind items: [title, what Rollins said (paraphrased), the question for RIDD (a suggestion, not a finding), source key]
  plays: [
    ['Leads: AI search is changing how people find a provider', 'Rollins blamed its residential slowdown (2.3% organic) on discovery, not demand: digital leads weakened again and organic site traffic fell. It is now buying ads on ChatGPT and Gemini.', 'Check the Marketing tab for the same drift in organic and paid-search leads, and whether RIDD shows up when someone asks an AI assistant for pest control in each branch city.', 'rolCall'],
    ['Speed and price up front', 'Their fix list: prices shown up front, same-day or next-day availability, more local content and listings.', 'Time to close and calls by hour show how fast a new lead gets a first service. Decide whether same-day or next-day start is a promise RIDD can make by branch.', 'rolCall'],
    ['Door-to-door is working for them too', 'Rollins said its door-to-door brands outperformed and grew double digits while inbound residential slowed.', 'RIDD already leans on this channel. The benchmark rows above show what it costs: growth far ahead, selling cost far ahead. The lever is keeping those accounts through the first winter.', 'rolCall'],
    ['Price increases of 3%\u20134%', 'Rollins reported price realization of about 3%\u20134% across the portfolio.', 'Compare with RIDD\u2019s last renewal and loyalty price changes on the Price Sheet, and decide the 2027 increase before renewals go out.', 'rolCall'],
    ['Insurance and fleet are squeezing margins', 'Rollins\u2019 gross margin fell about 90 bps, mostly insurance and claims plus fleet costs.', 'Watch Auto/Fuel and Insurance as a % of revenue on the P&L tab; the cost-structure table in the detail below shows both companies line by line.', 'rolCall'],
  ],
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

// RIDD's P&L, last 12 closed months, on the P&L tab's own QuickBooks grouping. Null until the ledger is loaded.
function marketWatchPnl() {
  if (devSampleData()) return { blocked: true };
  const M = typeof putisMonthly === 'function' ? putisMonthly() : null; if (!M) return null;
  const br = [...PUTIS_BRANCHES, 'Corporate'], open = putisOpenMonth();
  const closed = Object.keys(M).filter(ym => ym < open && putisDerive(M, ym, br).any).sort();
  if (closed.length < 12) return null;
  const yms = closed.slice(-12), prev = closed.slice(-24, -12);
  const d = putisDeriveMonths(M, yms, br); if (!(d.revenue > 0)) return null;
  const pc = (v) => v / d.revenue;
  const selling = d.marketing + d.commissions + d.incentives + d.housing;
  const officeWages = d.gaLines['Office Wages'] || 0, insurance = d.gaLines['Insurance'] || 0;
  const out = { from: yms[0], to: yms[11], revenue: d.revenue,
    cogs: pc(d.cogs), tech: pc(d.techWages), ms: pc(d.ms), auto: pc(d.auto), merchant: pc(d.merchant), gp: pc(d.gp),
    opex: pc(selling + d.ga), selling: pc(selling), officeWages: pc(officeWages), insurance: pc(insurance), gaOther: pc(d.ga - officeWages - insurance),
    da: d.da ? pc(d.da) : null, ebitda: pc(d.ebitda), op: d.da ? pc(d.ebitda - d.da) : null, adj: pc(d.ebitda + selling), revGrowth: null };
  if (prev.length === 12) { const p = putisDeriveMonths(M, prev, br); if (p.revenue > 0) out.revGrowth = d.revenue / p.revenue - 1; }
  return out;
}

function reportingMarketWatch() {
  if (!devSampleData() && typeof reportingLoadLedger === 'function') reportingLoadLedger();
  const P = marketWatchPnl();
  const pPct = (k) => !P ? (state._ledgerErr === 'unavailable' ? 'QuickBooks unavailable' : state.reportingLedger && !state._ledgerLoading ? 'needs 12 closed months' : 'loading QuickBooks…') : P.blocked ? 'admin only' : P[k] == null ? '—' : (P[k] * 100).toFixed(1) + '%';
  const pOn = !!(P && !P.blocked);
  const ymLbl = (ym) => new Date(ym + '-01T00:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const pSpan = pOn ? ymLbl(P.from) + ' – ' + ymLbl(P.to) : '';
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

  // ── Rollins at a glance: share price + next earnings ──
  if (!state._mwQuote && !state._mwQuoteLoading) {
    state._mwQuoteLoading = true;
    fetch('/api/market-quote').then(r => r.ok ? r.json() : null).then(j => { state._mwQuote = (j && j.price > 0) ? j : { unavailable: true }; }).catch(() => { state._mwQuote = { unavailable: true }; })
      .finally(() => { state._mwQuoteLoading = false; if (state.view === 'reporting' && state.reportingSubTab === 'market') mountApp(); });
  }
  const Qt = state._mwQuote, qOk = !!(Qt && Qt.price > 0);
  const spark = (() => {
    const c = qOk && Array.isArray(Qt.closes) ? Qt.closes : []; if (c.length < 8) return null;
    const NS = 'http://www.w3.org/2000/svg', w = 220, h = 44, lo = Math.min(...c), hi = Math.max(...c), up = c[c.length - 1] >= c[0];
    const s = document.createElementNS(NS, 'svg'); s.setAttribute('viewBox', '0 0 ' + w + ' ' + h); s.setAttribute('width', '100%'); s.style.maxWidth = '260px'; s.style.display = 'block';
    const pth = document.createElementNS(NS, 'path');
    pth.setAttribute('d', c.map((v, i) => (i ? 'L' : 'M') + (i / (c.length - 1) * w).toFixed(1) + ' ' + (h - 3 - (hi > lo ? (v - lo) / (hi - lo) : 0.5) * (h - 6)).toFixed(1)).join(' '));
    pth.setAttribute('fill', 'none'); pth.setAttribute('stroke', up ? '#15803D' : '#B91C1C'); pth.setAttribute('stroke-width', '2'); pth.setAttribute('stroke-linejoin', 'round');
    s.append(pth); return s;
  })();
  const yr1 = qOk && Qt.closes && Qt.closes.length >= 8 ? Qt.price / Qt.closes[0] - 1 : null;
  const big = (t, color) => el('div', { class: 'text-3xl font-black tabular-nums', style: { color } }, t);
  const cap = (t) => el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, t);
  const stockCard = el('div', { class: 'card p-5 flex flex-col gap-1' },
    cap('Rollins share price · NYSE: ROL'),
    qOk ? el('div', { class: 'flex items-end gap-3 flex-wrap' }, big('$' + Qt.price.toFixed(2)),
      Qt.changePct != null ? el('span', { class: 'text-sm font-bold tabular-nums pb-1', style: { color: Qt.change >= 0 ? '#15803D' : '#B91C1C' } }, (Qt.change >= 0 ? '+' : '−') + Math.abs(Qt.change).toFixed(2) + ' (' + pc(Qt.changePct) + ') today') : null)
      : big(Qt ? 'Price unavailable' : 'Loading…', 'var(--text-subtle)'),
    spark,
    qOk ? el('div', { class: 'text-[11px] tabular-nums', style: muted },
      [yr1 != null ? pc(yr1) + ' over 12 months' : null, Qt.lo52 && Qt.hi52 ? '52-week range $' + Qt.lo52.toFixed(2) + ' – $' + Qt.hi52.toFixed(2) : null,
        Qt.asOf ? 'as of ' + new Date(Qt.asOf).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : null, Qt.source].filter(Boolean).join(' · '))
      : el('a', { href: 'https://www.google.com/finance/quote/ROL:NYSE', target: '_blank', rel: 'noopener', class: 'text-[11px] underline', style: muted }, 'Open the live quote ↗'));
  const NE = M.nextEarnings;
  const neDays = NE.date ? Math.ceil((new Date(NE.date + 'T00:00') - new Date(new Date().toDateString())) / 86400000) : null;
  const earnCard = el('div', { class: 'card p-5 flex flex-col gap-1' },
    cap('Next Rollins earnings · ' + NE.label),
    big(NE.date ? new Date(NE.date + 'T00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : NE.expected),
    el('div', { class: 'text-[12px] font-semibold', style: { color: NE.date ? 'var(--accent)' : 'var(--text-muted)' } }, NE.date ? (neDays > 0 ? 'in ' + neDays + ' day' + (neDays === 1 ? '' : 's') : neDays === 0 ? 'today' : 'reported — update Market Watch') : 'Date not announced yet'),
    el('div', { class: 'text-[11px]', style: muted }, NE.basis),
    el('div', { class: 'text-[11px]', style: muted }, 'Last report: ' + NE.last),
    NE.also ? el('div', { class: 'text-[11px]', style: muted }, NE.also) : null,
    el('div', {}, src(NE.src)));

  // ── RIDD vs Rollins: the benchmark ──
  const B = M.bench;
  const benchRows = [
    { k: 'Revenue growth', rol: B.revGrowth, ridd: pOn ? P.revGrowth : null, hi: true, rolNote: 'organic ' + (B.organic * 100).toFixed(1) + '% · residential ' + (B.residential * 100).toFixed(1) + '%', how: 'RIDD: QuickBooks revenue, last 12 closed months vs the 12 before. Rollins: total revenue, first 9 months of 2026 vs 2025.' },
    { k: 'Gross margin', rol: B.gp, ridd: pOn ? P.gp : null, hi: true, how: 'Revenue minus cost of services. RIDD: tech wages, auto and fuel, chemicals and supplies, merchant fees. Rollins also carries service-side insurance and branch costs here.' },
    { k: 'Selling & marketing', rol: B.selling, ridd: pOn ? P.selling : null, hi: false, how: 'RIDD: marketing + commissions + incentives + housing, ÷ revenue. This is the price of growth: read it next to the growth row.' },
    { k: 'All operating expenses', rol: B.sga, ridd: pOn ? P.opex : null, hi: false, how: 'Rollins SG&A. RIDD: selling & marketing + G&A.' },
    { k: 'EBITDA margin', rol: B.ebitda, ridd: pOn ? P.ebitda : null, hi: true, how: 'Rollins adjusted EBITDA. RIDD: gross profit minus all operating expenses.' },
    { k: 'EBITDA before selling costs', rol: B.ebitda + B.selling, ridd: pOn ? P.adj : null, hi: true, rolNote: 'adjusted EBITDA + selling & marketing', how: 'What the service business earns before growth spend. Rollins does not publish this; it is its adjusted EBITDA margin plus its selling & marketing %, so both sides are built the same way.' },
    { k: 'Customer retention', rol: null, ridd: R.retention, hi: true, alt: B.rtoRetention, altLbl: 'Rentokil N. America', rolNote: 'Rollins does not publish a figure', how: 'RIDD: 1 − the Retention tab’s trailing-12-month attrition (subscriptions). Rentokil’s is its own customer definition — direction, not like for like.' },
  ];
  const scaleMax = Math.max(0.01, ...benchRows.flatMap(r => [r.rol, r.ridd, r.alt]).filter(v => v != null && isFinite(v)).map(Math.abs));
  const bBar = (v, color) => el('div', { style: { height: '8px', borderRadius: '999px', background: 'var(--card-2)', overflow: 'hidden' } }, v == null ? null : el('div', { style: { width: Math.max(1, Math.min(100, Math.abs(v) / scaleMax * 100)) + '%', height: '100%', background: color, borderRadius: '999px' } }));
  const p1 = (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%';
  const benchCard = card('RIDD vs Rollins', 'Rollins: first 9 months of 2026' + (pOn ? ' · RIDD: QuickBooks ' + pSpan : ''),
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse', minWidth: '640px' } },
      el('thead', {}, el('tr', {}, th('Measure'), th('Rollins'), th('RIDD'), th('Gap'))),
      el('tbody', {}, ...benchRows.map(r => {
        const ref = r.rol != null ? r.rol : r.alt, gap = (ref != null && r.ridd != null) ? r.ridd - ref : null, good = gap == null ? null : (r.hi ? gap >= 0 : gap <= 0);
        return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' }, title: r.how },
          el('td', { class: 'px-3 py-2 font-bold whitespace-nowrap' }, r.k, el('span', { class: 'ml-1 font-normal', style: { color: 'var(--text-subtle)', cursor: 'help' } }, 'ⓘ')),
          el('td', { class: 'px-3 py-2', style: { width: '30%' } }, el('div', { class: 'flex items-center gap-2' }, el('div', { style: { flex: '1' } }, bBar(ref, '#2F5D62')), el('span', { class: 'tabular-nums font-semibold', style: { minWidth: '46px' } }, p1(ref))),
            (r.rolNote || r.altLbl) ? el('div', { class: 'text-[10px]', style: muted }, [r.rol == null && r.altLbl ? r.altLbl + ' shown' : null, r.rolNote].filter(Boolean).join(' · ')) : null),
          el('td', { class: 'px-3 py-2', style: { width: '30%' } }, el('div', { class: 'flex items-center gap-2' }, el('div', { style: { flex: '1' } }, bBar(r.ridd, 'var(--accent)')),
            el('span', { class: 'tabular-nums font-black', style: { minWidth: '46px', color: r.ridd == null ? 'var(--text-subtle)' : 'var(--accent)' } }, r.ridd == null ? (r.k === 'Customer retention' ? '—' : pPct('gp') === 'admin only' ? 'admin only' : !P ? '…' : '—') : p1(r.ridd)))),
          el('td', { class: 'px-3 py-2 whitespace-nowrap' }, gap == null ? el('span', { style: { color: 'var(--text-subtle)' } }, '—')
            : el('span', { class: 'rounded-full px-2 py-0.5 text-[11px] font-black tabular-nums', style: { background: good ? 'rgba(21,128,61,.12)' : 'rgba(220,38,38,.12)', color: good ? '#15803D' : '#DC2626' } }, (gap >= 0 ? '+' : '−') + Math.abs(gap * 100).toFixed(1) + ' pts')));
      })))),
    el('div', { class: 'px-5 py-2 text-[10px] flex flex-wrap gap-x-4 gap-y-1', style: { color: 'var(--text-subtle)' } },
      el('span', {}, 'Green = RIDD ahead of Rollins on that line. Hover a measure for how each side is counted. Book growth (recurring ARR, last 12 months): ' + (R.growth == null ? '—' : pc(R.growth)) + '.'), src('rolQ3')));

  // ── What to act on ──
  const playsCard = card('What to act on', 'What Rollins is seeing, and the question it raises for RIDD',
    el('div', { class: 'px-5 pb-4 grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } }, ...M.plays.map(([t, said, ask, k]) => el('div', { style: { borderRadius: '10px', padding: '12px 14px', background: 'var(--card-2)', borderLeft: '3px solid var(--accent)' } },
      el('div', { class: 'text-[13px] font-bold' }, t),
      el('div', { class: 'text-[12px] mt-1', style: muted }, said),
      el('div', { class: 'text-[12px] mt-1.5' }, el('b', {}, 'For RIDD: '), ask),
      el('div', { class: 'mt-1' }, src(k))))));

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
  const kCard = card('Cost structure · Rollins full-year 2025 vs RIDD (% of revenue)', 'Revenue ' + K.revenue,
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th(''), th(''), th('Rollins', 1), th('RIDD' + (pOn ? ' · ' + pSpan : ''), 1))),
      el('tbody', {}, ...K.rows.map(([n, v, strong, rk, how]) => el('tr', { title: how || '', class: 'border-t', style: { borderColor: 'var(--border)', background: strong ? 'var(--card-2)' : undefined } },
        td(n, { b: !!strong }),
        el('td', { class: 'px-3 py-1.5', style: { width: '45%' } }, el('div', { style: { height: '8px', borderRadius: '999px', background: 'var(--card-2)', overflow: 'hidden', border: strong ? '1px solid var(--border)' : '0' } }, el('div', { style: { width: Math.min(100, parseFloat(v) || 0) + '%', height: '100%', background: strong ? '#2F5D62' : '#8F9A8C', borderRadius: '999px' } }))),
        td(v, { r: 1, b: !!strong }),
        el('td', { class: 'px-3 py-1.5 text-right tabular-nums whitespace-nowrap' + (strong ? ' font-bold' : ''), style: { color: rk && pOn && P[rk] != null ? 'var(--accent)' : 'var(--text-subtle)', cursor: how ? 'help' : undefined } }, rk ? pPct(rk) : '—')))))),
    el('div', { class: 'px-5 pt-2 text-[10px]', style: { color: 'var(--text-subtle)' } }, 'RIDD is % of QuickBooks revenue. Hover a row for the QuickBooks groups behind it. The companies sort costs differently (insurance, card fees, branch overhead), so compare the bold lines first.'),
    el('ul', { class: 'px-5 py-2 text-[12px] flex flex-col gap-0.5', style: muted }, ...K.facts.map(t => el('li', {}, '• ' + t))),
    el('div', { class: 'px-5 pb-3 flex gap-4 flex-wrap' }, src(K.src), src(K.factsSrc)));

  // ── Rentokil ──
  const T = M.rentokil;
  const tCard = card(T.label, null,
    el('div', { class: 'scroll-x', style: { borderTop: '1px solid var(--border)' } }, el('table', { class: 'w-full text-xs', style: { borderCollapse: 'collapse' } },
      el('tbody', {}, ...T.rows.map(([n, a, b]) => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(n, { b: true }), td(a, { r: 1, b: true }), el('td', { class: 'px-3 py-1.5', style: muted }, b || '')))))),
    el('div', { class: 'px-5 py-2' }, src(T.src)));

  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'text-[11px]', style: muted }, 'Market Watch \u00b7 Rollins is the benchmark \u00b7 public filings as of ' + new Date(M.asOf + 'T00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })),
    el('div', { class: 'no-arrange grid gap-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))' } }, stockCard, earnCard),
    benchCard, playsCard,
    el('details', { class: 'no-arrange' },
      el('summary', { class: 'text-[12px] font-bold cursor-pointer py-1', style: muted }, 'The full detail \u00b7 Rollins quarter, cost structure, what they said, Rentokil'),
      el('div', { class: 'flex flex-col gap-4 mt-3' }, sayCard,
        el('div', { class: 'grid gap-4', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))' } }, qCard, kCard), tCard)));
}
