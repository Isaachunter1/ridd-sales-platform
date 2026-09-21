// ┌─ src/80-putis-shid.js ─────────────────────────────────────────────────────
// │ Putis Shid — executive P&L by branch (QuickBooks via Windsor), metrics, unit economics.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════════
// PUTIS SHID — the executive P&L view (per Isaac's Executive Data Sheet).
// Every number comes from the QuickBooks general ledger (via Windsor, cached
// server-side — same feed as Marketing ad spend), classified by the branch
// prefix on each sub-account ("Atlanta Marketing", "Myrtle Beach Tech
// Wages", …) and the top-level account group. Sheet definitions:
//   M&S            = Chemicals and Job Supplies (chemicals + job supplies)
//   Auto/Fuel      = Auto and Fuel (auto expenses + fuel)
//   Gross Profit   = Revenue − (M&S + Auto/Fuel + Tech Wages + Merchant Fees)
//   Selling Exp    = Sales Commissions + Marketing + Incentives
//   G&A            = every other operating expense except Housing + Interest
//   EBITDA         = Gross Profit − (Selling + Housing + G&A)   (interest excluded)
//   Adjusted EBITDA= EBITDA + Selling Expense  (the sheet's F14 + F11×F3)
//   Cost per job   = each COGS line ÷ completed FieldRoutes appointments in the
//                    month (RevHawk, cached beside the ledger as `jobs`)
// ═══════════════════════════════════════════════════════════════════════════
const PUTIS_BRANCHES = ['Atlanta', 'Charleston', 'Destin', 'Detroit', 'Joplin', 'Little Rock', 'Myrtle Beach', 'Raleigh', 'Salt Lake', 'Virginia Beach', 'Tampa'];
const PUTIS_GROUP = {
  'sales': 'revenue',
  'chemicals and job supplies': 'ms',
  'auto and fuel': 'auto',
  'technician labor wages': 'techWages',
  'other cogs': 'merchant',
  'advertising & marketing': 'marketing',
  'incentive costs': 'incentives',
  'selling expenses': 'commissions',
  'housing': 'housing',
  'interest paid': 'interest',
  // G&A buckets
  'insurance': 'ga', 'legal fees': 'ga', 'legal & professional services': 'ga', 'office expenses': 'ga',
  'office wages': 'ga', 'postage and delivery': 'ga', 'recruiting': 'ga', 'rent & lease': 'ga', 'travel': 'ga',
  'bank charges & fees': 'ga', 'building cleaning': 'ga', 'car & truck': 'ga', 'geotab expenses': 'ga',
  'telephone': 'ga', 'utilities': 'ga', 'payroll': 'ga', 'software': 'ga', 'dues & subscriptions': 'ga',
  'meals & entertainment': 'ga', 'taxes & licenses': 'ga', 'repairs & maintenance': 'ga', 'uniforms': 'ga',
  'depreciation': 'da', 'amortization': 'da', 'depreciation expense': 'da',
};
const PUTIS_GA_LINES = ['Insurance', 'Legal Fees', 'Office Expenses', 'Office Wages', 'Postage and Delivery', 'Recruiting', 'Rent & Lease', 'Travel'];
function putisBranchOf(leaf) {
  const L = String(leaf || '').trim().toLowerCase();
  for (const b of PUTIS_BRANCHES) if (L.startsWith(b.toLowerCase())) return b;
  if (L.startsWith('utah')) return 'Salt Lake';
  return 'Corporate';   // Executive / Corporate / un-prefixed accounts (BayToast comish, interest, …)
}
function putisClassify(fullName) {
  const parts = String(fullName || '').split(':').map(s => s.trim());
  const top = (parts[0] || '').toLowerCase();
  const cat = PUTIS_GROUP[top];
  if (!cat) return null;                        // balance sheet, other income, Miami, …
  const leaf = parts[parts.length - 1];
  const branch = parts.length > 1 ? putisBranchOf(leaf) : 'Corporate';
  return { cat, branch, top: parts[0], leaf };
}
// {ym: {branch: {revenue, ms, auto, techWages, merchant, marketing, incentives, commissions, housing, ga, interest, da, gaLines:{}}}}
function putisMonthly() {
  const L = state.reportingLedger && state.reportingLedger.months;
  if (!L) return null;
  if (state._putisCacheFor === state.reportingLedger.pulledAt && state._putisCache) return state._putisCache;
  const out = {};
  const seed = () => ({ revenue: 0, ms: 0, auto: 0, techWages: 0, merchant: 0, marketing: 0, incentives: 0, commissions: 0, housing: 0, ga: 0, interest: 0, da: 0, jobs: 0, gaLines: {} });
  for (const ym in L) {
    for (const acct in L[ym]) {
      const c = putisClassify(acct); if (!c) continue;
      const amt = Number(L[ym][acct]) || 0; if (!amt) continue;
      const B = (out[ym] = out[ym] || {});
      const x = (B[c.branch] = B[c.branch] || seed());
      x[c.cat] += amt;
      if (c.cat === 'ga') x.gaLines[c.top] = (x.gaLines[c.top] || 0) + amt;
    }
  }
  // Completed jobs (FieldRoutes appointments with a completion date), by the
  // office they belong to → same branch buckets as the ledger.
  const J = state.reportingLedger.jobs && state.reportingLedger.jobs.months;
  if (J) for (const ym in J) {
    for (const office in J[ym]) {
      const n = Number(J[ym][office]) || 0; if (!n) continue;
      const B = (out[ym] = out[ym] || {});
      const x = (B[putisBranchOf(office)] = B[putisBranchOf(office)] || seed());
      x.jobs += n;
    }
  }
  state._putisCache = out; state._putisCacheFor = state.reportingLedger.pulledAt;
  return out;
}
// Roll a set of branches up for one month → derived lines.
function putisDerive(M, ym, branches) {
  const B = (M && M[ym]) || {};
  const t = { revenue: 0, ms: 0, auto: 0, techWages: 0, merchant: 0, marketing: 0, incentives: 0, commissions: 0, housing: 0, ga: 0, interest: 0, da: 0, jobs: 0, gaLines: {}, any: false };
  for (const b of branches) {
    const x = B[b]; if (!x) continue;
    // Jobs alone (a month the ledger hasn't booked yet) don't make the month 'booked'.
    if (['revenue', 'ms', 'auto', 'techWages', 'merchant', 'marketing', 'incentives', 'commissions', 'housing', 'ga', 'interest', 'da'].some(k => x[k])) t.any = true;
    for (const k of ['revenue', 'ms', 'auto', 'techWages', 'merchant', 'marketing', 'incentives', 'commissions', 'housing', 'ga', 'interest', 'da', 'jobs']) t[k] += x[k] || 0;
    for (const g in x.gaLines) t.gaLines[g] = (t.gaLines[g] || 0) + x.gaLines[g];
  }
  const rev = t.revenue;
  t.cogs = t.ms + t.auto + t.techWages + t.merchant;
  t.gp = rev - t.cogs;
  t.selling = t.commissions + t.marketing + t.incentives;
  t.opex = t.selling + t.housing + t.ga;
  t.ebitda = t.gp - t.opex;
  t.adjEbitda = t.ebitda + t.selling;
  t.netIncome = t.ebitda - t.interest - t.da;
  const pct = (v) => rev > 0 ? v / rev : null;
  t.msPct = pct(t.ms); t.autoPct = pct(t.auto); t.techPct = pct(t.techWages); t.merchantPct = pct(t.merchant); t.cogsPct = pct(t.cogs);
  t.gpPct = pct(t.gp); t.gaPct = pct(t.ga); t.sellingPct = pct(t.selling); t.marketingPct = pct(t.marketing);
  t.housingPct = pct(t.housing); t.incentivesPct = pct(t.incentives); t.commissionsPct = pct(t.commissions);
  t.opexPct = pct(t.opex); t.ebitdaPct = pct(t.ebitda); t.adjEbitdaPct = pct(t.adjEbitda); t.netPct = pct(t.netIncome);
  // Per completed job (FieldRoutes appointments completed in the period).
  const perJob = (v) => t.jobs > 0 ? v / t.jobs : null;
  t.cogsPerJob = perJob(t.cogs); t.techPerJob = perJob(t.techWages); t.autoPerJob = perJob(t.auto); t.msPerJob = perJob(t.ms); t.merchantPerJob = perJob(t.merchant);
  t.revPerJob = perJob(rev); t.gpPerJob = perJob(t.gp);
  return t;
}
function putisBranchesWithData(M, year) {
  const set = new Set();
  for (const ym in M) if (ym.startsWith(String(year))) for (const b in M[ym]) if (M[ym][b].revenue || M[ym][b].ga || M[ym][b].techWages) set.add(b);
  const order = [...PUTIS_BRANCHES, 'Corporate'];
  return order.filter(b => set.has(b));
}
// FieldRoutes side (reporting snapshot): active recurring subs + ARR per branch.
function putisFieldRoutes() {
  try {
    const F = reportingFilters();
    const out = {};
    for (const r of F.recurring) {
      if (!F.isActive(r)) continue;
      const b = putisBranchOf(String(r.office_name || '').toLowerCase().replace(/\s+/g, ' '));
      const x = (out[b] = out[b] || { active: 0, arr: 0, customers: new Set() });
      x.active++; x.arr += Number(r.annual_recurring_value) || 0;
      if (r.customer_id) x.customers.add(r.customer_id);
    }
    return out;
  } catch (e) { return {}; }
}
function reportingLoadLedger(force) {
  if (force) { state.reportingLedger = null; state._ledgerLoading = false; }
  if (state.reportingLedger != null || state._ledgerLoading) return;
  state._ledgerLoading = true;
  _apiAuthHeaders().then(h => fetch('/api/qbo-spend?full=1' + (force ? '&_=' + Date.now() : ''), { headers: h })).then(r => r.ok ? r.json() : null).then(j => {
    if (j && j.months) { state.reportingLedger = j; state._ledgerLoading = false; state._ledgerErr = null; mountApp(); }
    else if (j && j.pending) { state._ledgerLoading = false; state._ledgerErr = 'pulling'; setTimeout(() => reportingLoadLedger(false), 25000); mountApp(); }
    else { state._ledgerLoading = false; state._ledgerErr = 'unavailable'; state.reportingLedger = { months: {} }; mountApp(); }
  }).catch(() => { state._ledgerLoading = false; state._ledgerErr = 'unavailable'; state.reportingLedger = { months: {} }; mountApp(); });
}

const _putisUsd = (v) => v == null ? '—' : (v < 0 ? '-' : '') + '$' + Math.round(Math.abs(v)).toLocaleString();
const _putisPct1 = (v) => v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%';
const _putisSigned = (v, isPct) => v == null || !isFinite(v) ? '' : (v > 0 ? '+' : '') + (isPct ? (v * 100).toFixed(1) + ' pts' : _putisUsd(v));

const PUTIS_KPI_TIPS = {
  revenue: 'Booked revenue for the period (QuickBooks Sales accounts).',
  gpPct: 'Gross margin — revenue after chemicals, auto/fuel, tech wages and merchant fees.',
  ebitda: 'EBITDA — gross profit minus all operating expense. The bottom line before interest and depreciation.',
  adjEbitdaPct: 'Adjusted EBITDA margin — EBITDA + selling expense (commissions, marketing, incentives) ÷ revenue. Profitability of the service base before growth spend.',
  sellingPct: 'Selling expense ÷ revenue — the cost of growth (commissions + marketing + incentives).',
  netNewArr: 'Net new ARR — annual recurring value sold in the period minus ARV lost to real cancels (Retention-tab rules). Positive = the book grew.',
  ltvCac: 'LTV ÷ CAC — lifetime gross profit of an account (ACV × gross margin ÷ annual churn) divided by selling cost per new account. 3x+ is the usual PE bar.',
  paybackMo: 'CAC payback — months of gross profit needed to recover the selling cost of a new account. Under 12 is healthy for route-based services.',
  cac: 'CAC — selling expense (commissions + marketing + incentives) ÷ new recurring accounts sold in the period.',
  monthlyChurn: 'Monthly churn — average real cancels per month ÷ active accounts today (Retention-tab rules: excluded reasons and 3-day ROR stripped).',
  acv: 'ACV — active ARR ÷ active accounts.',
  revPerActive: 'Monthly revenue per active account — booked revenue ÷ months ÷ active accounts today.',
  arrCoverage: 'ARR realisation — booked monthly revenue ÷ (ARR ÷ 12). Above 1.0 means billing ran ahead of the recurring base (initials, upsells); below means under-billing or seasonal timing.',
  gaPerActive: 'Monthly G&A per active account — overhead leverage. Should fall as branches scale.',
  concentration: 'Share of company revenue from the largest branch.',
  jobs: 'Completed jobs — FieldRoutes appointments with a completion date in the period, by the office they belong to (RevHawk).',
  cogsPerJob: 'COGS per completed job — (chemicals & job supplies + auto & fuel + tech wages + merchant fees) ÷ completed appointments. The all-in cost of rolling a truck to one stop.',
};
// Putis Shid rows (sheet order).
const PUTIS_ROWS = [
  { id: 'revenue',      label: 'Revenue',          kind: 'usd', bold: true,  tip: 'Revenue — every QuickBooks "Sales:<Branch> Sales" income account for the month. Recognized revenue as booked on the P&L, not FieldRoutes contract value.' },
  { id: 'msPct',        label: 'M&S',              kind: 'pct', lowGood: true, tip: 'Materials & Supplies as a % of revenue — "Chemicals and Job Supplies" (chemical products + job supplies COGS) ÷ revenue. Lower is better.' },
  { id: 'autoPct',      label: 'Auto/Fuel',        kind: 'pct', lowGood: true, tip: 'Auto & fuel as a % of revenue — "Auto and Fuel" (auto expenses + fuel expense) ÷ revenue. Lower is better.' },
  { id: 'techPct',      label: 'Tech Wages',       kind: 'pct', lowGood: true, tip: 'Technician labor as a % of revenue — "Technician Labor Wages" ÷ revenue. Lower is better.' },
  { id: 'merchantPct',  label: 'Merchant Fees',    kind: 'pct', lowGood: true, tip: 'Card-processing fees as a % of revenue — "Other COGS: Merchant Fees" ÷ revenue.' },
  { id: 'cogs',         label: 'COGS',             kind: 'usd', lowGood: true, tip: 'Cost of goods sold in dollars — M&S + auto/fuel + tech wages + merchant fees.' },
  { id: 'gp',           label: 'Gross Profit',     kind: 'usd', bold: true,  tip: 'Gross profit — revenue minus the four cost-of-service lines above (M&S + auto/fuel + tech wages + merchant fees). What is left to cover selling and overhead.' },
  { id: 'gpPct',        label: 'Gross Profit %',   kind: 'pct',              tip: 'Gross margin — gross profit ÷ revenue. Higher is better.' },
  // ── Cost per completed job (COGS lines ÷ FieldRoutes completed appointments) ──
  { head: 'Cost per completed job · FieldRoutes appointments' },
  { id: 'jobs',         label: 'Completed jobs',   kind: 'int',              tip: PUTIS_KPI_TIPS.jobs },
  { id: 'cogsPerJob',   label: 'COGS ÷ job',       kind: 'usd2', bold: true, lowGood: true, tip: PUTIS_KPI_TIPS.cogsPerJob },
  { id: 'techPerJob',   label: 'Tech wages ÷ job', kind: 'usd2', lowGood: true, tip: 'Technician labor wages ÷ completed jobs.' },
  { id: 'autoPerJob',   label: 'Auto/Fuel ÷ job',  kind: 'usd2', lowGood: true, tip: 'Auto expenses + fuel ÷ completed jobs.' },
  { id: 'msPerJob',     label: 'M&S ÷ job',        kind: 'usd2', lowGood: true, tip: 'Chemicals & job supplies ÷ completed jobs.' },
  { id: 'merchantPerJob', label: 'Merchant fees ÷ job', kind: 'usd2', lowGood: true, tip: 'Card-processing fees ÷ completed jobs.' },
  { id: 'revPerJob',    label: 'Revenue ÷ job',    kind: 'usd2',             tip: 'Booked revenue ÷ completed jobs — what an average stop bills.' },
  { id: 'gpPerJob',     label: 'Gross profit ÷ job', kind: 'usd2', bold: true, signed: true, tip: 'Revenue ÷ job minus COGS ÷ job — what one stop leaves after the truck, tech, chemicals and card fees.' },
  { head: 'Operating expense' },
  { id: 'gaPct',        label: 'G&A',              kind: 'pct', lowGood: true, tip: 'General & administrative as a % of revenue — every other operating expense group (insurance, legal, office expenses, office wages, postage, recruiting, rent & lease, travel, utilities, telephone, software, bank fees…) ÷ revenue. Excludes housing, selling expense and interest.' },
  { id: 'sellingPct',   label: 'Selling Expense',  kind: 'pct', lowGood: true, tip: 'Cost of selling as a % of revenue — (sales commissions + advertising & marketing + incentive costs) ÷ revenue. Lower is better.' },
  { id: 'marketing',    label: 'Marketing',        kind: 'usd',              tip: 'Advertising & marketing dollars — the "<Branch> Marketing" sub-accounts under Advertising & Marketing. Same feed as the Marketing tab’s ad spend.' },
  { id: 'marketingPct', label: 'Marketing %',      kind: 'pct', lowGood: true, tip: 'Marketing as a % of revenue — marketing ÷ revenue.' },
  { id: 'ebitda',       label: 'EBITDA',           kind: 'usd', bold: true, signed: true, tip: 'Earnings before interest, taxes, depreciation & amortization — gross profit minus all operating expense (selling expense + housing + G&A). Interest and depreciation are excluded. Red = loss.' },
  { id: 'adjEbitda',    label: 'Adjusted EBITDA',  kind: 'usd', bold: true, signed: true, tip: 'EBITDA before the cost of selling — EBITDA + selling expense (commissions + marketing + incentives). What the service business earns on its own, separate from growth spend. The sheet’s F14 + F11 × F3.' },
  { id: 'netIncome',    label: 'Net Income',       kind: 'usd', bold: true, signed: true, tip: 'EBITDA minus interest paid and depreciation/amortization.' },
  // ── FieldRoutes book (point-in-time at month end) ──
  // ── Balance sheet (company only — QuickBooks has no per-branch balance sheet) ──
  { head: 'Debt · QuickBooks balance sheet', company: true },
  { id: 'ltDebt',       label: 'Long-term debt',   kind: 'usd', point: true, bold: true, company: true, lowGood: true, tip: 'Long-term liabilities at month end — total liabilities minus current liabilities on the QuickBooks balance sheet (the term debt). Balance-sheet history starts Dec 2025.' },
  { id: 'totalLiab',    label: 'Total liabilities', kind: 'usd', point: true, company: true, lowGood: true, tip: 'Every liability at month end — A/P, credit cards, accrued/other current liabilities and long-term debt.' },
  { id: 'cash',         label: 'Cash',             kind: 'usd', point: true, company: true, tip: 'Bank-account balances at month end.' },
  { id: 'netDebt',      label: 'Net debt',         kind: 'usd', point: true, company: true, lowGood: true, tip: 'Long-term debt minus cash.' },
  { id: 'debtToRev',    label: 'Debt / TTM revenue', kind: 'x', point: true, company: true, lowGood: true, tip: 'Long-term debt ÷ trailing-twelve-month booked revenue (annualised when fewer than 12 closed months are in the feed). 1.0x = one year of revenue owed.' },
  { id: 'debtToArr',    label: 'Debt / ARR',       kind: 'x', point: true, company: true, lowGood: true, tip: 'Long-term debt ÷ month-end active ARR (FieldRoutes). The recurring-revenue lender view.' },
  { id: 'leverage',     label: 'Net debt / TTM adj. EBITDA', kind: 'x', point: true, company: true, lowGood: true, tip: 'Net debt ÷ trailing-twelve-month adjusted EBITDA (annualised when fewer than 12 closed months). The standard PE leverage multiple; blank when TTM adjusted EBITDA is not positive.' },
];
// ── Reconcile the retention book against a hand-built FieldRoutes export ──
// Isaac runs the same rules by hand in a spreadsheet; this diffs his final
// population (Customer ID + Subscription) against the app's book and says,
// row by row, WHY each side has something the other doesn't.
function retenParseCsv(text) {
  const rows = []; let row = [], cell = '', q = false;
  const src = String(text || '').replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (q) { if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && src[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); rows.push(row); }
  if (!rows.length) return [];
  const head = rows[0].map(h => String(h || '').trim().toLowerCase());
  return rows.slice(1).filter(r => r.some(v => String(v || '').trim() !== '')).map(r => { const o = {}; head.forEach((h, i) => { o[h] = r[i] != null ? String(r[i]).trim() : ''; }); return o; });
}
function retenReconcile(fileRows, pop, book, _retenEff, ground) {
  const key = (cid, sub) => String(cid || '').trim() + '|' + String(sub || '').trim().toLowerCase();
  const fk = (o) => key(o['customer id'] || o.customer_id, o['subscription'] || o.subscription);
  const ak = (r) => key(r.customer_id, r.subscription);
  const fileMap = new Map(); fileRows.forEach(o => fileMap.set(fk(o), o));
  // ── Top of the funnel (per Isaac): the raw FieldRoutes pull with ONLY
  // "received an initial service" applied, against everything the app has
  // with a completed initial — before any removal step. Same key.
  let top = null;
  if (Array.isArray(ground)) {
    const g = ground.filter(r => !!r.initial_service);
    const gMap = new Map(); g.forEach(r => { const k = ak(r); if (!gMap.has(k)) gMap.set(k, r); });
    const allMap = new Map(); ground.forEach(r => { const k = ak(r); if (!allMap.has(k)) allMap.set(k, r); });
    const matchedTop = [...gMap.keys()].filter(k => fileMap.has(k)).length;
    const appOnlyTop = g.filter(r => !fileMap.has(ak(r))).map(r => ({ ...r, _why:
      r.customer_missing ? 'customer deleted in FieldRoutes (orphan)'
      : r.subscription_date_canceled ? 'cancelled · ' + (reportingCancelReasonOf(r) || 'no reason') + ' (' + String(r.initial_service).slice(0, 4) + ')'
      : 'active, ' + (Number(r.subscription_completed_services) || 0) + ' services (' + String(r.initial_service).slice(0, 4) + ')' }));
    const fileOnlyTop = [];
    for (const [k, o] of fileMap) {
      if (gMap.has(k)) continue;
      const r = allMap.get(k);
      const why = !r ? 'not in the app snapshot at all (sold after the sync, or a different service-type spelling)'
        : !r.initial_service ? 'app: initial not marked Completed (' + (r.initial_status || 'no status') + ')'
        : 'app: other';
      const row = r ? { ...r } : { customer_id: o['customer id'], last_name: o['last name'], first_name: o['first name'], subscription: o['subscription'], subscription_status: o['subscription status'], subscription_date_canceled: o['subscription date canceled'] || '', subscription_cancellation_reason: o['subscription cancellation reason'] || '', annual_recurring_value: Number(String(o['annual recurring value'] || '').replace(/[$,]/g, '')) || 0, office_name: o['office name'], initial_service: o['initial service'], subscription_completed_services: o['subscription completed services'] };
      row._why = why; fileOnlyTop.push(row);
    }
    top = { fileCount: fileMap.size, appCount: g.length, groundCount: ground.length, matched: matchedTop, appOnly: appOnlyTop, fileOnly: fileOnlyTop };
  }
  const bookMap = new Map(); book.forEach(r => bookMap.set(ak(r), r));
  const popMap = new Map(); pop.forEach(r => { const k = ak(r); if (!popMap.has(k)) popMap.set(k, r); });
  const recurringByName = reportingServiceRecurringMap();
  const matched = [...bookMap.keys()].filter(k => fileMap.has(k)).length;
  // App has it, the file doesn't — describe the row so Isaac can see why he dropped it.
  const appOnly = book.filter(r => !fileMap.has(ak(r))).map(r => {
    const svc = Number(r.subscription_completed_services) || 0;
    const yr = r.initial_service ? String(r.initial_service).slice(0, 4) : '?';
    const why = /frozen/i.test(String(r.subscription_status || '')) && svc <= 1 ? 'frozen after 1 service (' + yr + ')'
      : svc <= 1 ? '1 service, still active (' + yr + ')'
      : r.subscription_date_canceled ? 'cancelled · ' + (reportingCancelReasonOf(r) || 'no reason')
      : 'active, ' + svc + ' services (' + yr + ')';
    return { ...r, _why: why };
  });
  // File has it, the app doesn't — which step took it out (or is it missing from the snapshot).
  const fileOnly = [];
  for (const [k, o] of fileMap) {
    if (bookMap.has(k)) continue;
    const r = popMap.get(k);
    let why;
    if (!r) why = 'not in app snapshot (sold after sync, other scope, or deleted-in-CRM)';
    else if (!recurringByName.get(r.subscription)) why = 'app: not a recurring service';
    else if (!r.initial_service) why = 'app: no initial service';
    else why = 'app: ' + (retenPopulationExcluded(r) || 'excluded (other)');
    const row = r ? { ...r } : {
      customer_id: o['customer id'], last_name: o['last name'], first_name: o['first name'], subscription: o['subscription'],
      subscription_status: o['subscription status'], subscription_date_canceled: o['subscription date canceled'] || '',
      subscription_cancellation_reason: o['subscription cancellation reason'] || '', annual_recurring_value: Number(String(o['annual recurring value'] || '').replace(/[$,]/g, '')) || 0,
      office_name: o['office name'], initial_service: o['initial service'], subscription_completed_services: o['subscription completed services'],
    };
    row._why = why; fileOnly.push(row);
  }
  return { fileCount: fileMap.size, bookCount: book.length, matched, appOnly, fileOnly, top };
}
function openRetenReconcileModal(res) {
  const n = (v) => Number(v || 0).toLocaleString();
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const groupTable = (title, rows, note) => {
    const g = new Map(); rows.forEach(r => g.set(r._why, (g.get(r._why) || []).concat([r])));
    const ents = [...g.entries()].sort((a, b) => b[1].length - a[1].length);
    return el('div', { class: 'flex flex-col gap-1.5' },
      el('div', { class: 'flex items-baseline justify-between gap-3' },
        el('div', { class: 'text-sm font-bold' }, title, ' ', el('span', { class: 'text-[11px] font-semibold', style: { color: 'var(--text-muted)' } }, n(rows.length))),
        rows.length ? el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => openReportingDrillModal({ chartTitle: title, sliceLabel: n(rows.length) + ' subscriptions', rows, formatValue: fmt.usd0 }) }, 'All rows →') : null),
      note ? el('div', { class: 'text-[11px] text-muted-' }, note) : null,
      ents.length ? el('table', { class: 'w-full text-xs' }, el('tbody', {}, ...ents.map(([why, rs]) => el('tr', { class: 'border-t cursor-pointer hover:brightness-95', style: { borderColor: 'var(--border)' }, onclick: () => openReportingDrillModal({ chartTitle: title + ' · ' + why, sliceLabel: n(rs.length) + ' subscriptions', rows: rs, formatValue: fmt.usd0 }) },
        el('td', { class: 'py-1.5 pr-3' }, why), el('td', { class: 'py-1.5 text-right tabular-nums font-semibold' }, n(rs.length)))))) : el('div', { class: 'text-xs text-muted-' }, 'None — the two runs agree here.'));
  };
  const exportBtn = el('button', { class: 'rounded-lg px-2.5 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => {
    const esc = (v) => { const s = String(v == null ? '' : v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    const cols = ['side', 'why', 'customer_id', 'last_name', 'first_name', 'subscription', 'subscription_status', 'subscription_date_canceled', 'subscription_cancellation_reason', 'subscription_completed_services', 'initial_service', 'annual_recurring_value', 'office_name'];
    const lines = [cols.join(',')];
    res.appOnly.forEach(r => lines.push(['book · app only', r._why, ...cols.slice(2).map(c => r[c])].map(esc).join(',')));
    res.fileOnly.forEach(r => lines.push(['book · file only', r._why, ...cols.slice(2).map(c => r[c])].map(esc).join(',')));
    if (res.top) { res.top.appOnly.forEach(r => lines.push(['top · app only', r._why, ...cols.slice(2).map(c => r[c])].map(esc).join(','))); res.top.fileOnly.forEach(r => lines.push(['top · file only', r._why, ...cols.slice(2).map(c => r[c])].map(esc).join(','))); }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob(['﻿' + lines.join('\n')], { type: 'text/csv' })); a.download = 'retention-reconcile-' + new Date().toISOString().slice(0, 10) + '.csv'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } }, '⬇ Export differences');
  overlay.append(el('div', { class: 'card p-5 flex flex-col gap-4', style: { width: 'min(720px, 94vw)', maxHeight: '88vh', overflow: 'auto' } },
    el('div', { class: 'flex items-start justify-between gap-3' },
      el('div', {}, el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Retention book reconciliation'),
        el('div', { class: 'text-lg font-black' }, n(res.matched) + ' match · ' + n(res.appOnly.length) + ' only in app · ' + n(res.fileOnly.length) + ' only in your file'),
        el('div', { class: 'text-[11px] text-muted-' }, 'App book ' + n(res.bookCount) + ' · your file ' + n(res.fileCount) + ' · matched on Customer ID + Subscription')),
      el('div', { class: 'flex items-center gap-2' }, exportBtn, el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '×'))),
    res.top ? el('div', { class: 'flex flex-col gap-3 p-3 rounded-xl', style: { background: 'var(--card-2)' } },
      el('div', {},
        el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Top of the funnel · subs with a completed initial, before any step'),
        el('div', { class: 'text-base font-black' }, n(res.top.matched) + ' match · ' + n(res.top.appOnly.length) + ' only in app · ' + n(res.top.fileOnly.length) + ' only in your file'),
        el('div', { class: 'text-[11px] text-muted-' }, 'App: ' + n(res.top.appCount) + ' with a completed initial (of ' + n(res.top.groundCount) + ' in the whole snapshot) · your file ' + n(res.top.fileCount))),
      groupTable('Only in the app (top)', res.top.appOnly, 'In the app with a completed initial but not in your pull.'),
      groupTable('Only in your file (top)', res.top.fileOnly, 'In your pull but the app has no completed initial for it — or does not have the row at all.')) : null,
    el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'Retention book · after every step'),
    groupTable('Only in the app', res.appOnly, 'Rows the app keeps that your file dropped — grouped by what the row looks like, so you can spot which of your steps removed them.'),
    groupTable('Only in your file', res.fileOnly, 'Rows you kept that the app removed — grouped by the app step that removed them (or missing from the snapshot).')));
  document.body.append(overlay);
}

// Phones can't hover — tapping a row label opens this instead of a tooltip.
function putisExplain(label, tip) {
  const overlay = el('div', { class: 'modal-overlay' });
  const _escClose = (e) => { if (e.key === 'Escape' || !overlay.isConnected) { overlay.remove(); document.removeEventListener('keydown', _escClose); } };
  document.addEventListener('keydown', _escClose);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.append(el('div', { class: 'card p-5 flex flex-col gap-2', style: { width: 'min(440px, 92vw)' } },
    el('div', { class: 'flex items-start justify-between gap-3' },
      el('div', { class: 'text-base font-bold' }, label),
      el('button', { class: 'text-2xl leading-none text-muted-', 'aria-label': 'Close', title: 'Close', onclick: () => overlay.remove() }, '×')),
    el('div', { class: 'text-sm', style: { color: 'var(--text-muted)', lineHeight: '1.5' } }, tip || 'Straight from the QuickBooks general ledger for the selected period.')));
  document.body.append(overlay);
}
// Attach FieldRoutes month-end book + (company scope) balance-sheet / leverage
// values to a derived month so the trend table can show them beside the P&L.
function putisAugment(d, M, ym, branches, company) {
  const U = putisUnitMonthly();
  if (d.any || (U.months && U.months[ym])) { const um = putisMetrics(M, U, [ym], branches); for (const k of ['newSubs', 'newArr', 'renewals', 'expArr', 'lostArr', 'netNewArr', 'monthlyChurn', 'cac', 'mktgPerNew', 'acv', 'ltv', 'ltvCac', 'paybackMo']) d[k] = um[k]; }
  const E = U.eom && U.eom[ym];
  if (E) { let arr = 0, n = 0, any = false; for (const b of branches) { const x = E[b]; if (!x) continue; any = true; arr += x.arr; n += x.active; } if (any) { d.arrEom = arr; d.activeEom = n; d.arrToRev = arr > 0 && d.any ? d.revenue / (arr / 12) : null; } }
  if (!company) return d;
  const B = state.reportingLedger && state.reportingLedger.balance && state.reportingLedger.balance[ym];
  if (!B) return d;
  d.ltDebt = B.ltDebt; d.totalLiab = B.liabilities; d.cash = B.cash; d.netDebt = B.ltDebt - B.cash;
  // Trailing twelve closed months ending at ym (annualised if the feed is shorter).
  let [y, m] = ym.split('-').map(Number); const yms = [];
  for (let i = 0; i < 12; i++) { yms.push(y + '-' + String(m).padStart(2, '0')); if (--m < 1) { m = 12; y--; } }
  const openYm = putisOpenMonth();
  const closed = yms.filter(x => x < openYm && M && M[x]);
  if (closed.length) {
    const t = putisDeriveMonths(M, closed, branches);
    const k = 12 / closed.length;
    const ttmRev = t.revenue * k, ttmAdj = t.adjEbitda * k;
    d.debtToRev = ttmRev > 0 ? B.ltDebt / ttmRev : null;
    d.leverage = ttmAdj > 0 ? d.netDebt / ttmAdj : null;
  }
  d.debtToArr = d.arrEom > 0 ? B.ltDebt / d.arrEom : null;
  return d;
}
const PUTIS_COL_TIPS = {
  month: 'Booked amounts for this calendar month from the QuickBooks general ledger. — means nothing is booked yet. The current month is open until the books close, so it moves.',
  ytd: 'Year to date — every booked month of the year added together. Percentage rows are recomputed from the summed dollars, not averaged.',
  prior: 'Prior-year total — the same rows for every month of last year that QuickBooks has. The feed starts last January, so the comparison can be partial.',
  yoy: 'Year over year — this year’s YTD minus the prior-year total. Dollar rows show $ change; percentage rows show the change in points.',
};
// The current calendar month is still OPEN in the books (per Isaac: not
// accurate until close) — YTD stops at the prior month and the defaults
// point at the last closed month.
function putisOpenMonth() { const n = new Date(); return _mktgYm(n.getFullYear(), n.getMonth()); }
function putisLastClosedMonth() { const n = new Date(); const p = new Date(n.getFullYear(), n.getMonth() - 1, 1); return _mktgYm(p.getFullYear(), p.getMonth()); }
// Year rollup for a row: $ rows sum; % rows recompute from summed dollars.
// Skips the open month.
function putisYear(M, year, branches) {
  const t = { revenue: 0, ms: 0, auto: 0, techWages: 0, merchant: 0, merchantX: 0, marketing: 0, incentives: 0, commissions: 0, housing: 0, ga: 0, interest: 0, da: 0, jobs: 0, months: 0 };
  const openYm = putisOpenMonth();
  for (let i = 0; i < 12; i++) {
    const ym = _mktgYm(year, i);
    if (ym >= openYm) continue;
    const d = putisDerive(M, ym, branches);
    if (!d.any) continue;
    t.months++;
    for (const k of ['revenue', 'ms', 'auto', 'techWages', 'merchant', 'marketing', 'incentives', 'commissions', 'housing', 'ga', 'interest', 'da', 'jobs']) t[k] += d[k] || 0;
  }
  const fake = { [year + '-00']: { X: { ...t, gaLines: {} } } };
  const d = putisDerive(fake, year + '-00', ['X']);
  d.months = t.months;
  return d;
}

function putisTrendCard(M, year, branches, title, subtitle, headerExtra, opts = {}) {
  const company = !!opts.company;
  subtitle = null;   // descriptions retired (per Isaac) — hover tips on the rows carry the detail
  const months = Array.from({ length: 12 }, (_, i) => putisAugment(putisDerive(M, _mktgYm(year, i), branches), M, _mktgYm(year, i), branches, company));
  const openYm = putisOpenMonth();
  // Range: 'all' = the 12-month strip; 'YYYY-MM' = that one month beside YTD
  // through it (and the same span of the prior year).
  const rangeYm = opts.range && /^\d{4}-\d{2}$/.test(opts.range) ? opts.range : null;
  const upto = rangeYm ? Number(rangeYm.slice(5, 7)) - 1 : 11;
  const shownIdx = rangeYm ? [upto] : Array.from({ length: 12 }, (_, i) => i);
  const rollup = (yr) => {
    const ks = []; for (let i = 0; i <= upto; i++) { const k = _mktgYm(yr, i); if (k < openYm && M && M[k]) ks.push(k); }
    if (!ks.length) return { months: 0 };
    const d = putisDeriveMonths(M, ks, branches); d.months = ks.length; return d;
  };
  const ytd = rollup(year), prior = rollup(year - 1);
  // Trailing twelve closed months ending at the range end (the shown month,
  // or the last closed month of the year on the 12-month strip).
  const ttm = (() => {
    const endIdx = rangeYm ? upto : Math.max(...Array.from({ length: 12 }, (_, i) => i).filter(i => _mktgYm(year, i) < openYm && M && M[_mktgYm(year, i)]), -1);
    if (endIdx < 0) return { months: 0, ks: [] };
    const ks = []; let y = year, m = endIdx;
    for (let i = 0; i < 12; i++) { const k = _mktgYm(y, m); if (k < openYm && M && M[k]) ks.push(k); if (--m < 0) { m = 11; y--; } }
    if (!ks.length) return { months: 0, ks: [] };
    const d = putisDeriveMonths(M, ks, branches); d.months = ks.length; d.ks = ks; return d;
  })();
  // Point-in-time rows: "YTD" = latest closed month with a value (through the
  // range end), "prior" = the same point a year earlier.
  const latestPoint = (yr, id) => {
    for (let i = upto; i >= 0; i--) { const ym = _mktgYm(yr, i); if (ym >= openYm) continue; const d = yr === year ? months[i] : putisAugment(putisDerive(M, ym, branches), M, ym, branches, company); if (d[id] != null) return d[id]; }
    return null;
  };
  const rowsShown = PUTIS_ROWS.filter(r => !r.company || company);
  const fmtRow = (row, v) => v == null || !isFinite(v) ? '—' : row.kind === 'pct' ? _putisPct1(v) : row.kind === 'x' ? v.toFixed(2) + 'x' : row.kind === 'mo' ? v.toFixed(1) + ' mo' : row.kind === 'int' ? Math.round(v).toLocaleString() : row.kind === 'usd2' ? (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2) : _putisUsd(v);
  // Period rollups for the unit-economics rows (ratios recomputed over the period, not averaged).
  const _U = putisUnitMonthly();
  const _closedOf = (yr) => Array.from({ length: upto + 1 }, (_, i) => _mktgYm(yr, i)).filter(k => k < openYm && M && M[k]);
  const ytdU = _closedOf(year).length ? putisMetrics(M, _U, _closedOf(year), branches) : null;
  const priorU = _closedOf(year - 1).length ? putisMetrics(M, _U, _closedOf(year - 1), branches) : null;
  const deltaMode = state._putisDelta === 'mom' || state._putisDelta === 'yoy' ? state._putisDelta : 'none';
  const showMoM = deltaMode !== 'none';
  const lyMonths = deltaMode === 'yoy' ? Array.from({ length: 12 }, (_, i) => { const k = _mktgYm(year - 1, i); return M && M[k] ? putisAugment(putisDerive(M, k, branches), M, k, branches, company) : null; }) : null;
  const th = (t, extra, tip) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap text-left ' + (extra || '') + (tip ? ' cursor-help' : ''), style: { color: 'var(--text-muted)' }, title: tip || '' }, t);
  const td = (content, o = {}) => el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap align-top' + (o.bold ? ' font-bold' : '') + (o.title && !o.onclick ? ' cursor-help' : ''), style: o.style || {}, title: o.title || '', onclick: o.onclick }, content);
  const cellVal = (row, d, prev) => {
    const v = (row.point || row.unit) ? d[row.id] : (d.any ? d[row.id] : null);
    const label = fmtRow(row, v);
    const col = row.red && v > 0 ? { color: '#DC2626' } : row.signed && v != null ? { color: v < 0 ? '#DC2626' : '#5F6C5B' } : {};
    const node = el('div', { style: col }, label);
    if (showMoM && prev && v != null && prev[row.id] != null && isFinite(v) && isFinite(prev[row.id])) {
      const delta = v - prev[row.id];
      const good = row.lowGood ? delta <= 0 : delta >= 0;
      node.append(el('div', { class: 'text-[9px]', style: { color: Math.abs(delta) < 1e-9 ? 'var(--text-subtle)' : good ? '#5F6C5B' : '#DC2626' } }, signedRow(row, delta)));
    }
    return node;
  };
  const signedRow = (row, v) => v == null || !isFinite(v) ? '' : row.kind === 'pct' ? _putisSigned(v, true) : row.kind === 'x' ? (v > 0 ? '+' : '') + v.toFixed(2) + 'x' : row.kind === 'mo' ? (v > 0 ? '+' : '') + v.toFixed(1) + ' mo' : row.kind === 'int' ? (v > 0 ? '+' : '') + Math.round(v).toLocaleString() : row.kind === 'usd2' ? (v > 0 ? '+' : v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2) : _putisSigned(v, false);
  const ytdVal = (row) => row.unit ? (ytdU ? ytdU[row.id] : null) : row.point ? latestPoint(year, row.id) : (ytd.months ? ytd[row.id] : null);
  const priorVal = (row) => row.unit ? (priorU ? priorU[row.id] : null) : row.point ? latestPoint(year - 1, row.id) : (prior.months ? prior[row.id] : null);
  const yoy = (row) => {
    const a = ytdVal(row), b = priorVal(row);
    if (a == null || b == null || !isFinite(a) || !isFinite(b)) return '—';
    return signedRow(row, a - b) || '—';
  };
  const table = el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } },
    el('thead', {}, el('tr', {}, th('', 'sticky left-0'), ...shownIdx.map(i => { const m = MKTG_MONTHS[i]; const isOpen = _mktgYm(year, i) === putisOpenMonth(); return th(isOpen ? m + ' · open' : (rangeYm ? m + ' ' + year : m), isOpen ? 'italic' : '', isOpen ? 'Current month — books not closed yet, numbers move daily. Not included in YTD.' : PUTIS_COL_TIPS.month); }),
      th(year + ' YTD' + (ytd.months ? ' (thru ' + MKTG_MONTHS[Math.min(upto, Math.max(0, (String(year) === openYm.slice(0, 4) ? new Date().getMonth() - 1 : 11)))] + ')' : ''), '', PUTIS_COL_TIPS.ytd + ' The open (current) month is excluded.'),
      th('Trailing 12 mo', '', ttm.months ? 'The last twelve closed months, ' + ttm.ks[ttm.ks.length - 1] + ' through ' + ttm.ks[0] + (ttm.months < 12 ? ' (' + ttm.months + ' available in the feed)' : '') + '. Percentage rows are recomputed from the summed dollars.' : 'No closed months yet.'))),
    el('tbody', {}, ...rowsShown.map(row => row.head
      ? el('tr', { class: 'border-t border-' }, el('td', { colspan: '16', class: 'px-2 pt-3 pb-1 text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)', position: 'sticky', left: 0 } }, row.head))
      : el('tr', { class: 'border-t border-' + (row.bold ? ' font-semibold' : ''), style: row.bold ? { background: 'var(--card-2)' } : {} },
      td(row.label, { bold: true, title: row.tip, style: { position: 'sticky', left: 0, background: row.bold ? 'var(--card-2)' : 'var(--card)', zIndex: 1, boxShadow: '1px 0 0 var(--border)', cursor: opts.compact ? 'pointer' : undefined }, onclick: opts.compact ? () => putisExplain(row.label, row.tip) : undefined }),
      ...shownIdx.map(i => {
        const d = months[i];
        const ym = _mktgYm(year, i);
        const c = td(cellVal(row, d, deltaMode === 'yoy' ? lyMonths[i] : (i > 0 ? months[i - 1] : null)), ym === putisOpenMonth() ? { style: { opacity: '.45' }, title: 'Open month — not closed yet' } : {});
        if (row.drill) {
          const B = _U.months[ym] || {}; const list = []; for (const b of branches) { const x = B[b]; if (x && x[row.drill]) list.push(...x[row.drill]); }
          if (list.length) { c.classList.add('cursor-pointer', 'hover:underline'); c.title = 'Click to see the ' + list.length.toLocaleString() + ' subscription' + (list.length === 1 ? '' : 's'); c.onclick = () => openReportingDrillModal({ chartTitle: title + ' · ' + row.label, sliceLabel: MKTG_MONTHS[i] + ' ' + year + ' · ' + list.length.toLocaleString() + ' subscription' + (list.length === 1 ? '' : 's'), rows: list, formatValue: fmt.usd0 }); }
        }
        return c;
      }),
      td(fmtRow(row, ytdVal(row)), { bold: true, title: row.point ? 'Latest closed month with a value' : '', style: row.signed && ytdVal(row) != null ? { color: ytdVal(row) < 0 ? '#DC2626' : '#5F6C5B' } : {} }),
      (() => { const v = row.point ? ytdVal(row) : (ttm.months ? ttm[row.id] : null); return td(fmtRow(row, v), { bold: true, title: row.point ? 'Latest closed month with a value' : '', style: row.signed && v != null ? { color: v < 0 ? '#DC2626' : '#5F6C5B' } : {} }); })()))));
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-center gap-3' + (opts.compact ? '' : ' flex-wrap'), style: { borderColor: 'var(--border)' } },
      el('div', { class: 'min-w-0' }, el('h3', { class: 'text-sm font-bold' }, title), subtitle ? el('div', { class: 'text-[9px] uppercase tracking-widest mt-1', style: { color: 'var(--text-subtle)' } }, subtitle) : null),
      headerExtra || null),
    el('div', { class: 'scroll-x' }, table));
}

// Sum several months into one synthetic month so putisDerive can roll it up (YTD).
function putisDeriveMonths(M, yms, branches) {
  if (yms.length === 1) return putisDerive(M, yms[0], branches);
  const merged = {};
  for (const ym of yms) {
    const B = (M && M[ym]) || {};
    for (const b of branches) {
      const x = B[b]; if (!x) continue;
      const t = (merged[b] = merged[b] || { revenue: 0, ms: 0, auto: 0, techWages: 0, merchant: 0, marketing: 0, incentives: 0, commissions: 0, housing: 0, ga: 0, interest: 0, da: 0, jobs: 0, gaLines: {} });
      for (const k of ['revenue', 'ms', 'auto', 'techWages', 'merchant', 'marketing', 'incentives', 'commissions', 'housing', 'ga', 'interest', 'da', 'jobs']) t[k] += x[k] || 0;
      for (const g in x.gaLines) t.gaLines[g] = (t.gaLines[g] || 0) + x.gaLines[g];
    }
  }
  return putisDerive({ _: merged }, '_', branches);
}
// P&L Indicators — one month OR year-to-date, branch columns (the sheet's P&L tab).
function putisIndicatorsCard(M, ym, branches, opts = {}) {
  const FR = putisFieldRoutes();
  const U = putisUnitMonthly();
  const isYtd = /^\d{4}-YTD$/.test(ym);
  const year = ym.slice(0, 4);
  const yms = isYtd ? Object.keys(M).filter(k => k.startsWith(year + '-') && /^\d{4}-\d{2}$/.test(k) && k < putisOpenMonth()).sort() : [ym];
  const endYm = yms[yms.length - 1] || ym;
  const bookAtEnd = U.eom && U.eom[endYm];   // month-end book for the period; falls back to today
  let cols = [...branches.map(b => ({ key: b, label: b, set: [b] })), { key: 'RIDD', label: 'RIDD', set: branches }];
  if (opts.onlyCol) cols = cols.filter(c => c.key === opts.onlyCol);   // phones: one column at a time
  const D = Object.fromEntries(cols.map(c => [c.key, putisDeriveMonths(M, yms, c.set)]));
  const UM = Object.fromEntries(cols.map(c => [c.key, putisMetrics(M, U, yms, c.set)]));
  const fr = (key) => {
    const set = cols.find(c => c.key === key).set;
    const t = { active: 0, arr: 0 };
    for (const b of set) { const x = bookAtEnd ? bookAtEnd[b] : FR[b]; if (x) { t.active += x.active; t.arr += x.arr; } }
    return t;
  };
  const endLabel = new Date(endYm + '-15T12:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  // Term debt by branch (today's balances of the long-term liability accounts).
  const debtAccts = state.reportingLedger && state.reportingLedger.debt && state.reportingLedger.debt.accounts;
  // Branch = the loan accounts named for it. Corporate = everything else on
  // the balance sheet's long-term liabilities (un-branched loan accounts AND
  // any long-term liability not booked to a named loan), so the columns
  // always add up to the balance-sheet total (per Isaac).
  const debtBy = debtAccts && Object.keys(debtAccts).length ? (() => {
    const byBranch = {}; let named = 0;
    const _ovr = (_adminRules() && _adminRules().debtAcctBranch) || {};
    for (const name in debtAccts) { const n = name.toLowerCase(); const b = _ovr[name] ? (_ovr[name] === 'Corporate' ? null : _ovr[name]) : (PUTIS_BRANCHES.find(x => n.includes(x.toLowerCase())) || (n.includes('utah') ? 'Salt Lake' : null)); if (b) { byBranch[b] = (byBranch[b] || 0) + debtAccts[name]; named += debtAccts[name]; } else { byBranch.Corporate = (byBranch.Corporate || 0) + debtAccts[name]; } }
    const BS = state.reportingLedger.balance || {}; const bsKeys = Object.keys(BS).sort(); const latest = bsKeys.length ? BS[bsKeys[bsKeys.length - 1]] : null;
    const total = latest && latest.ltDebt > 0 ? latest.ltDebt : Object.values(byBranch).reduce((a, v) => a + v, 0);
    byBranch.Corporate = Math.max(0, total - named);   // whatever isn't a branch-named loan
    return (key) => { const set = cols.find(c => c.key === key).set; if (key === 'RIDD') return total; let t = 0, any = false; for (const b of set) if (byBranch[b] != null) { t += byBranch[b]; any = true; } return any ? t : null; };
  })() : null;
  const th = (t, tip, corner) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap text-left' + (tip ? ' cursor-help' : ''), style: { color: 'var(--text-muted)', position: 'sticky', top: 0, left: corner ? 0 : undefined, zIndex: corner ? 3 : 2, background: 'var(--card)', boxShadow: '0 1px 0 var(--border)' }, title: tip || '' }, t);
  const td = (v, o = {}) => el('td', { class: 'px-2 py-1 tabular-nums whitespace-nowrap' + (o.bold ? ' font-bold' : '') + (o.muted ? ' text-muted-' : '') + (o.title && !o.onclick ? ' cursor-help' : ''), style: o.style || {}, title: o.title || '', onclick: o.onclick }, v);
  // Income-statement card: every $ column gets a "% of revenue" column beside it (per Isaac).
  // Desktop: click a branch header to pop its "% of revenue" column open
  // (click again to close). Phones (one column) always show it.
  const part = opts.section || 'all';   // 'book' | 'margins' | 'unit' | 'pnl' | 'all'
  const pctSet = state._putisPctCols instanceof Set ? state._putisPctCols : (state._putisPctCols = new Set());
  const withPct = !['book', 'margins', 'unit'].includes(opts.section || 'all');
  const pctOn = (key) => withPct && (opts.onlyCol ? true : pctSet.has(key));
  const nCols = cols.reduce((a, c) => a + (pctOn(c.key) ? 2 : 1), 0);
  // Rows are collected as descriptors first so a clicked row label can
  // re-order the branch columns (asc/desc by that metric; RIDD stays last).
  const section = (label, tip) => ({ _section: label, tip });
  const line = (label, f, o = {}) => ({ _label: label, f, o });
  const sortSt = state._putisSort && state._putisSort.part === part ? state._putisSort : null;
  const renderSection = (r) => el('tr', {}, el('td', { class: 'px-2 pt-3 pb-1 text-[9px] uppercase tracking-widest font-bold' + (r.tip ? ' cursor-help' : ''), style: { color: 'var(--text-subtle)' }, colspan: nCols + 1, title: r.tip || '' }, r._section));
  // One column (phones): a tap on the label explains the metric instead of
  // sorting — there's nothing to sort.
  const single = !!opts.onlyCol;
  const renderLine = (label, f, o = {}) => el('tr', { class: 'border-t border-' + (o.bold ? ' font-semibold' : ''), style: o.bold ? { background: 'var(--card-2)' } : {} },
    td(el('span', { class: 'inline-flex items-center gap-1' }, label, !single && sortSt && sortSt.label === label ? el('span', { style: { color: 'var(--accent)' } }, sortSt.dir === 'asc' ? '▲' : '▼') : null), { bold: true, title: single ? (o.tip || '') : (o.tip ? o.tip + ' · ' : '') + 'Click to sort branches by this row', style: { position: 'sticky', left: 0, background: o.bold ? 'var(--card-2)' : 'var(--card)', zIndex: 1, boxShadow: '1px 0 0 var(--border)', cursor: 'pointer', userSelect: 'none' },
      onclick: single ? () => putisExplain(label, o.tip) : () => { const cur = state._putisSort; state._putisSort = (cur && cur.part === part && cur.label === label) ? (cur.dir === 'desc' ? { part, label, dir: 'asc' } : null) : { part, label, dir: 'desc' }; mountApp(); } }),
    ...cols.flatMap(c => { const v = f(D[c.key], c.key); const s = o.red && typeof v === 'number' && v > 0 ? { color: '#DC2626' } : o.signed && typeof v === 'number' ? { color: v < 0 ? '#DC2626' : '#5F6C5B' } : {};
      const isUsd = !(o.pct || o.num || o.x || o.mo || o.usd2);
      const cell = td(v == null || (typeof v === 'number' && !isFinite(v)) ? '—' : o.pct ? _putisPct1(v) : o.num ? Math.round(v).toLocaleString() : o.x ? v.toFixed(2) + 'x' : o.mo ? v.toFixed(1) + ' mo' : o.usd2 ? '$' + v.toFixed(2) : _putisUsd(v), { style: { ...s, borderLeft: '1px solid var(--border)' }, muted: o.muted });
      if (!pctOn(c.key)) return [cell];
      const rev = D[c.key].revenue;
      const pv = isUsd && typeof v === 'number' && isFinite(v) && rev > 0 ? v / rev : null;
      return [cell, td(pv == null ? '' : _putisPct1(pv), { style: { color: 'var(--text-muted)', fontSize: '11px' } })]; }));
  const TIPS = {
    'Total income': 'All "Sales:<Branch> Sales" income accounts.',
    'Chemicals & job supplies': '"Chemicals and Job Supplies": chemical products + job supplies COGS.',
    'Auto & fuel': '"Auto and Fuel": auto expenses + fuel expense.',
    'Technician labor wages': '"Technician Labor Wages" by branch.',
    'Merchant fees': '"Other COGS: Merchant Fees" — card processing.',
    'Cost of goods sold': 'Chemicals & job supplies + auto & fuel + tech wages + merchant fees.',
    'Gross profit': 'Total income − cost of goods sold (as $ or ÷ total income in Margins).',
    'Advertising & marketing': '"Advertising & Marketing: <Branch> Marketing" — same feed as the Marketing tab.',
    'Sales commissions': '"Selling Expenses" group — sales commissions, MD expenses, BayToast comish (corporate).',
    'Incentive costs': '"Incentive Costs" — branch incentives, competition prizes, retreats.',
    'Housing': '"Housing" — summer rep housing by branch. Operating expense, but not part of G&A or selling.',
    'Other G&A': 'Remaining G&A groups: bank charges, building cleaning, car & truck, Geotab, telephone, utilities, payroll, software, legal & professional…',
    'Total expenses': 'All operating expense: selling (commissions + marketing + incentives) + housing + G&A. Interest and depreciation excluded.',
    'EBITDA': 'Gross profit − total expenses. Earnings before interest, taxes, depreciation & amortization.',
    'Interest paid': '"Interest Paid" — interest expense (corporate).',
    'Net income': 'EBITDA − interest paid − depreciation/amortization.',
    'Recurring revenue (active ARR)': 'Annual recurring value of every active recurring subscription in the branch — same rule as the Overview tab’s Active ARR. As of the last FieldRoutes sync.',
    'Active accounts': 'Active recurring subscriptions right now (status Active, no cancel date).',
    'ACV (ARR ÷ active accounts)': 'Average annual contract value per active account.',
    'Revenue ÷ active account': 'Booked revenue this period per active account today.',
    'EBITDA ÷ active account': 'EBITDA this period per active account today.',
    'Product cost (M&S)': 'Chemicals & job supplies ÷ total income.',
    'Tech wages': 'Technician labor wages ÷ total income.',
    'OPEX': 'Total expenses ÷ total income.',
    'Selling expense': '(Commissions + marketing + incentives) ÷ total income.',
    'G&A': 'G&A ÷ total income.',
    'Marketing': 'Advertising & marketing ÷ total income.',
    'Adjusted EBITDA': 'Adjusted EBITDA ÷ total income.',
    'Net profit': 'Net income ÷ total income.',
  };
  PUTIS_GA_LINES.forEach(g => { TIPS[g] = 'G&A line: the "' + g + '" account group, by branch.'; });
  const _line = line;
  const lineT = (label, f, o = {}) => _line(label, f, { ...o, tip: o.tip || TIPS[label] || '' });
  const rows = [
    section('Income statement', 'Dollars booked in QuickBooks for the selected month (or year to date), by branch. Corporate = accounts with no branch prefix.'),
    lineT('Total income', d => d.revenue, { bold: true }),
    lineT('Chemicals & job supplies', d => d.ms),
    lineT('Auto & fuel', d => d.auto),
    lineT('Technician labor wages', d => d.techWages),
    lineT('Merchant fees', d => d.merchant),
    lineT('Cost of goods sold', d => d.cogs, { bold: true }),
    lineT('Gross profit', d => d.gp, { bold: true, signed: true }),
    lineT('Advertising & marketing', d => d.marketing),
    lineT('Sales commissions', d => d.commissions),
    lineT('Incentive costs', d => d.incentives),
    lineT('Housing', d => d.housing),
    ...PUTIS_GA_LINES.map(g => lineT(g, d => d.gaLines[g] || 0)),
    lineT('Other G&A', d => Object.keys(d.gaLines).filter(g => !PUTIS_GA_LINES.includes(g)).reduce((s, g) => s + d.gaLines[g], 0)),
    lineT('Total expenses', d => d.opex, { bold: true }),
    lineT('EBITDA', d => d.ebitda, { bold: true, signed: true }),
    lineT('Interest paid', d => d.interest),
    lineT('Net income', d => d.netIncome, { bold: true, signed: true }),
    lineT('Adjusted EBITDA', d => d.adjEbitda, { bold: true, signed: true, tip: 'EBITDA + selling expense: the service business on its own, before growth spend.' }),
    'BOOK',
    lineT('Recurring revenue (active ARR)', (d, k) => fr(k).arr, { bold: true, tip: 'Annual recurring value of every recurring subscription on the books at the end of the period (any cancel reason removes it).' }),
    lineT('Active accounts', (d, k) => fr(k).active, { num: true, tip: 'Recurring subscriptions on the books at the end of the period.' }),
    lineT('ACV (ARR ÷ active accounts)', (d, k) => { const f = fr(k); return f.active ? f.arr / f.active : null; }),
    lineT('Revenue ÷ active account', (d, k) => { const f = fr(k); return f.active ? d.revenue / f.active : null; }, { tip: 'Booked revenue for the period ÷ accounts on the books at period end.' }),
    lineT('EBITDA ÷ active account', (d, k) => { const f = fr(k); return f.active ? d.ebitda / f.active : null; }, { signed: true, tip: 'EBITDA for the period ÷ accounts on the books at period end.' }),
    ...(debtBy ? [
      lineT('Term debt (today)', (d, k) => debtBy(k), { bold: true, tip: 'Long-term liability accounts on the QuickBooks balance sheet, current balance, filed to the branch named in the account (e.g. "Mizzen Loan - Atlanta"); un-branched loan accounts sit under Corporate. RIDD = every loan account.' }),
      lineT('Debt ÷ ARR', (d, k) => { const f = fr(k); const x = debtBy(k); return f.arr > 0 && x != null ? x / f.arr : null; }, { x: true, tip: 'Term debt ÷ active ARR at period end — years of recurring revenue owed.' }),
    ] : []),
    'MARGINS',
    lineT('Product cost (M&S)', d => d.msPct, { pct: true }),
    lineT('Auto & fuel', d => d.autoPct, { pct: true }),
    lineT('Tech wages', d => d.techPct, { pct: true }),
    lineT('Merchant fees', d => d.merchantPct, { pct: true, tip: 'Merchant fees ÷ total income.' }),
    lineT('Cost of goods sold', d => d.cogsPct, { pct: true, bold: true }),
    lineT('Gross profit', d => d.gpPct, { pct: true, bold: true }),
    lineT('OPEX', d => d.opexPct, { pct: true }),
    lineT('Selling expense', d => d.sellingPct, { pct: true }),
    lineT('G&A', d => d.gaPct, { pct: true }),
    lineT('Marketing', d => d.marketingPct, { pct: true }),
    lineT('EBITDA', d => d.ebitdaPct, { pct: true, bold: true, signed: true }),
    lineT('Adjusted EBITDA', d => d.adjEbitdaPct, { pct: true, bold: true, signed: true }),
    lineT('Net profit', d => d.netPct, { pct: true, signed: true }),
    section('Cost per completed job', 'Each cost-of-service line ÷ FieldRoutes appointments completed in the period (by the office they belong to). RIDD = company total ÷ company jobs.'),
    lineT('Completed jobs', d => d.jobs, { num: true, tip: PUTIS_KPI_TIPS.jobs }),
    lineT('COGS ÷ job', d => d.cogsPerJob, { usd2: true, bold: true, tip: PUTIS_KPI_TIPS.cogsPerJob }),
    lineT('Tech wages ÷ job', d => d.techPerJob, { usd2: true, tip: 'Technician labor wages ÷ completed jobs.' }),
    lineT('Auto & fuel ÷ job', d => d.autoPerJob, { usd2: true, tip: 'Auto expenses + fuel ÷ completed jobs.' }),
    lineT('M&S ÷ job', d => d.msPerJob, { usd2: true, tip: 'Chemicals & job supplies ÷ completed jobs.' }),
    lineT('Merchant fees ÷ job', d => d.merchantPerJob, { usd2: true, tip: 'Card-processing fees ÷ completed jobs.' }),
    lineT('Revenue ÷ job', d => d.revPerJob, { usd2: true, tip: 'Booked revenue ÷ completed jobs.' }),
    lineT('Gross profit ÷ job', d => d.gpPerJob, { usd2: true, bold: true, signed: true, tip: 'Revenue ÷ job − COGS ÷ job.' }),
    'UNIT',
    lineT('New recurring accounts', (d, k) => UM[k].newSubs, { num: true, tip: 'Recurring subscriptions sold in the period (renewals of existing customers not included).' }),
    lineT('New ARR sold', (d, k) => UM[k].newArr, { tip: 'Annual recurring value of the accounts sold in the period.' }),
    lineT('Renewals', (d, k) => UM[k].renewals, { num: true, tip: 'Existing customers re-signed onto a new plan in the period — not new accounts.' }),
    lineT('Renewal ARR change', (d, k) => UM[k].expArr, { signed: true, tip: 'New plan ARR minus the ARR of the plan it replaced. Green = expansion, red = contraction.' }),
    lineT('Churned ARR', (d, k) => UM[k].lostArr, { red: true, tip: 'Annual recurring value lost to real cancels in the period (excluded reasons and 3-day ROR stripped).' }),
    lineT('Net new ARR', (d, k) => UM[k].netNewArr, { bold: true, signed: true, tip: 'New ARR + renewal ARR change − churned ARR.' }),
    lineT('Churn / month', (d, k) => UM[k].monthlyChurn, { pct: true, tip: PUTIS_KPI_TIPS.monthlyChurn }),
    lineT('CAC (selling cost ÷ new account)', (d, k) => UM[k].cac, { tip: PUTIS_KPI_TIPS.cac }),
    lineT('Marketing ÷ new account', (d, k) => UM[k].mktgPerNew, { tip: 'Advertising & marketing dollars ÷ new recurring accounts sold.' }),
    lineT('LTV (gross profit per account)', (d, k) => UM[k].ltv, { tip: 'ACV × gross margin ÷ annualised churn — lifetime gross profit of one account.' }),
    lineT('LTV ÷ CAC', (d, k) => UM[k].ltvCac, { x: true, bold: true, tip: PUTIS_KPI_TIPS.ltvCac }),
    lineT('CAC payback (months)', (d, k) => UM[k].paybackMo, { mo: true, tip: PUTIS_KPI_TIPS.paybackMo }),
  ];
  const marks = { pnl: [0, rows.indexOf('BOOK')], book: [rows.indexOf('BOOK') + 1, rows.indexOf('MARGINS')], margins: [rows.indexOf('MARGINS') + 1, rows.indexOf('UNIT')], unit: [rows.indexOf('UNIT') + 1, rows.length] };
  const shownDefs = marks[part] ? rows.slice(marks[part][0], marks[part][1]) : rows.filter(r => typeof r !== 'string');
  if (sortSt) {
    const def = shownDefs.find(r => r && r._label === sortSt.label);
    if (def) {
      const valOf = (c) => { const v = def.f(D[c.key], c.key); return typeof v === 'number' && isFinite(v) ? v : null; };
      const ridd = cols.filter(c => c.key === 'RIDD'), rest = cols.filter(c => c.key !== 'RIDD');
      rest.sort((a, b) => { const x = valOf(a), y = valOf(b); if (x == null && y == null) return 0; if (x == null) return 1; if (y == null) return -1; return sortSt.dir === 'asc' ? x - y : y - x; });
      cols = [...rest, ...ridd];
    }
  }
  // A section label that opens the table is redundant (the card title says
  // it) and leaves a gap under the header — drop it.
  while (shownDefs.length && shownDefs[0] && shownDefs[0]._section != null) shownDefs.shift();
  const shown = shownDefs.map(r => r && r._section != null ? renderSection(r) : renderLine(r._label, r.f, r.o));
  const periodLabel = isYtd ? year + ' YTD (' + yms.length + ' month' + (yms.length === 1 ? '' : 's') + ' booked)' : new Date(ym + '-15T12:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-center justify-between gap-3' + (opts.compact ? '' : ' flex-wrap'), style: { borderColor: 'var(--border)' } },
      el('div', { class: 'min-w-0' },
        el('h3', { class: 'text-sm font-bold' + (opts.compact ? ' truncate' : '') }, (opts.title || ({ book: 'Recurring Book', margins: 'Margins', unit: 'Unit Economics' })[part] || 'P&L Indicators') + (opts.compact ? '' : ' · ' + periodLabel)),
        null),
      opts.headerExtra || null),
    el('div', { class: 'scroll-x', style: { overflow: 'auto', maxHeight: '80vh' } }, el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, th('', '', true), ...cols.flatMap(c => {
        const on = pctOn(c.key);
        const h = th(c.label + (withPct && !opts.onlyCol ? (on ? ' ▾' : ' ▸') : ''), withPct && !opts.onlyCol ? (on ? 'Click to hide the % of revenue column' : 'Click to show % of revenue for ' + c.label) : '');
        h.style.borderLeft = '1px solid var(--border)';
        if (withPct && !opts.onlyCol) { h.classList.add('cursor-pointer', 'select-none'); h.onclick = () => { if (pctSet.has(c.key)) pctSet.delete(c.key); else pctSet.add(c.key); mountApp(); }; }
        return on ? [h, th('% rev', '')] : [h]; }))),
      el('tbody', {}, ...shown))));
}

// ── Unit economics from FieldRoutes (per branch, per month) ──────────────
// New recurring accounts sold, new ARR, real cancels, lost ARR — using the
// SAME rules as the Overview / Retention tabs (reportingFilters), so CAC,
// churn and LTV here tie to what the rest of Reporting shows.
function putisUnitMonthly() {
  if (state._putisUnitCache && state._putisUnitCacheFor === (state.reportingSnapshotStamp || (state.reportingSubscriptions || []).length)) return state._putisUnitCache;
  const out = {};   // {ym: {branch: {newSubs, newArr, cancels, lostArr}}}
  const active = {}; // {branch: {active, arr}} as of today
  const delta = {}, eom = {}; // month-end ARR / active accounts per branch
  try {
    const F = reportingFilters();
    const seed = () => ({ newSubs: 0, newArr: 0, cancels: 0, lostArr: 0, renewals: 0, expArr: 0, newRows: [], renRows: [], cxlRows: [] });
    for (const r of F.recurring) {
      const b = putisBranchOf(String(r.office_name || '').toLowerCase());
      const arv = Number(r.annual_recurring_value) || 0;
      const sd = String(r.sold_date || '').slice(0, 7);
      if (/^\d{4}-\d{2}$/.test(sd)) {
        const x = ((out[sd] = out[sd] || {})[b] = (out[sd] || {})[b] || seed());
        // A renewal continuation is the same customer on a new plan: not a
        // new account, and only the ARR CHANGE is growth (expansion or
        // contraction), never the whole renewal ARR.
        if (r.is_renewal_cont) { x.renewals++; x.expArr += arv - (Number(r.renewal_prev_arv) || 0); x.renRows.push(r); }
        else { x.newSubs++; x.newArr += arv; x.newRows.push(r); }
      }
      if (F.isRealCancel(r)) {
        const cd = String(r.subscription_date_canceled || '').slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(cd)) { const x = ((out[cd] = out[cd] || {})[b] = (out[cd] || {})[b] || seed()); x.cancels++; x.lostArr += arv; x.cxlRows.push(r); }
      }
      if (F.isActive(r)) { const a = (active[b] = active[b] || { active: 0, arr: 0 }); a.active++; a.arr += arv; }
      // Month-end book: +ARV from the sold month, -ARV from the month it was
      // cancelled (any reason — the ARR is gone either way).
      if (/^\d{4}-\d{2}$/.test(sd)) {
        const dd = ((delta[sd] = delta[sd] || {})[b] = (delta[sd] || {})[b] || { arr: 0, n: 0 }); dd.arr += arv; dd.n++;
        const cd = String(r.subscription_date_canceled || '').slice(0, 7);
        if (/^\d{4}-\d{2}$/.test(cd) && cd >= sd) { const dc = ((delta[cd] = delta[cd] || {})[b] = (delta[cd] || {})[b] || { arr: 0, n: 0 }); dc.arr -= arv; dc.n--; }
      }
    }
    // Prefix-sum the deltas month by month → {ym: {branch: {arr, active}}}.
    const yms = Object.keys(delta).sort();
    if (yms.length) {
      const run = {};
      const last = putisOpenMonth();
      let [y, m] = yms[0].split('-').map(Number);
      for (;;) {
        const ym = y + '-' + String(m).padStart(2, '0');
        const D = delta[ym] || {};
        for (const b in D) { const x = (run[b] = run[b] || { arr: 0, active: 0 }); x.arr += D[b].arr; x.active += D[b].n; }
        eom[ym] = {}; for (const b in run) eom[ym][b] = { arr: run[b].arr, active: run[b].active };
        if (ym >= last) break;
        if (++m > 12) { m = 1; y++; }
      }
    }
  } catch (e) { /* snapshot not loaded */ }
  state._putisUnitCache = { months: out, active, eom };
  state._putisUnitCacheFor = state.reportingSnapshotStamp || (state.reportingSubscriptions || []).length;
  return state._putisUnitCache;
}
function putisUnitSum(U, yms, branches) {
  const t = { newSubs: 0, newArr: 0, cancels: 0, lostArr: 0, renewals: 0, expArr: 0, active: 0, arr: 0 };
  for (const ym of yms) { const B = U.months[ym] || {}; for (const b of branches) { const x = B[b]; if (!x) continue; t.newSubs += x.newSubs; t.newArr += x.newArr; t.cancels += x.cancels; t.lostArr += x.lostArr; t.renewals += x.renewals || 0; t.expArr += x.expArr || 0; } }
  for (const b of branches) { const a = U.active[b]; if (a) { t.active += a.active; t.arr += a.arr; } }
  return t;
}
// Everything a PE reader wants for one scope + period, in one object.
function putisMetrics(M, U, yms, branches) {
  const d = putisDeriveMonths(M, yms, branches);
  const u = putisUnitSum(U, yms, branches);
  const n = yms.length || 1;
  const m = { ...d, ...u, months: n };
  m.acv = u.active ? u.arr / u.active : null;
  m.cac = u.newSubs ? d.selling / u.newSubs : null;                  // selling expense per new account
  m.mktgPerNew = u.newSubs ? d.marketing / u.newSubs : null;
  m.monthlyChurn = u.active ? (u.cancels / n) / u.active : null;      // avg monthly cancels ÷ active today
  m.annualChurn = m.monthlyChurn != null ? Math.min(1, m.monthlyChurn * 12) : null;
  m.grossAcv = m.acv != null && d.gpPct != null ? m.acv * d.gpPct : null;
  m.ltv = m.grossAcv != null && m.annualChurn ? m.grossAcv / m.annualChurn : null;
  m.ltvCac = m.ltv != null && m.cac ? m.ltv / m.cac : null;
  m.paybackMo = m.cac != null && m.grossAcv ? m.cac / (m.grossAcv / 12) : null;
  m.netNewArr = u.newArr + u.expArr - u.lostArr;   // new + renewal expansion − churned
  m.revPerActive = u.active ? d.revenue / n / u.active : null;        // monthly revenue per active account
  m.ebitdaPerActive = u.active ? d.ebitda / n / u.active : null;
  m.gaPerActive = u.active ? d.ga / n / u.active : null;
  m.arrCoverage = u.arr ? (d.revenue / n) / (u.arr / 12) : null;      // booked monthly revenue vs 1/12 of ARR
  return m;
}

// ── Reorganised Putis Shid (per Isaac — "put your PE hat on") ───────────
function _putisFmt(kind, v) {
  if (v == null || !isFinite(v)) return '—';
  if (kind === 'usd') return _putisUsd(v);
  if (kind === 'usd2') return (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(0);
  if (kind === 'pct') return _putisPct1(v);
  if (kind === 'x') return v.toFixed(1) + 'x';
  if (kind === 'mo') return v.toFixed(1) + ' mo';
  if (kind === 'int') return Math.round(v).toLocaleString();
  return String(v);
}
function _putisDelta(kind, cur, prev, lowGood) {
  if (cur == null || prev == null || !isFinite(cur) || !isFinite(prev)) return null;
  const d = cur - prev;
  const good = lowGood ? d <= 0 : d >= 0;
  const txt = kind === 'pct' ? (d > 0 ? '+' : '') + (d * 100).toFixed(1) + ' pts' : kind === 'x' ? (d > 0 ? '+' : '') + d.toFixed(1) + 'x' : kind === 'mo' ? (d > 0 ? '+' : '') + d.toFixed(1) + ' mo' : (d > 0 ? '+' : '') + _putisUsd(d);
  return el('span', { class: 'text-[10px] font-semibold', style: { color: Math.abs(d) < 1e-9 ? 'var(--text-subtle)' : good ? '#5F6C5B' : '#DC2626' } }, txt);
}

function putisKpiStrip(M, U, closedYm, branches) {
  const yr = closedYm.slice(0, 4);
  const prevYm = (() => { const d = new Date(closedYm + '-15T12:00'); d.setMonth(d.getMonth() - 1); return _mktgYm(d.getFullYear(), d.getMonth()); })();
  const lastYearYm = String(Number(yr) - 1) + closedYm.slice(4);
  const cur = putisMetrics(M, U, [closedYm], branches);
  const prev = putisMetrics(M, U, [prevYm], branches);
  const ly = M[lastYearYm] ? putisMetrics(M, U, [lastYearYm], branches) : null;
  const ytdMonths = Object.keys(M).filter(k => k.startsWith(yr + '-') && k <= closedYm).sort();
  const ytd = putisMetrics(M, U, ytdMonths, branches);
  const tiles = [
    { id: 'revenue', label: 'Revenue', kind: 'usd' },
    { id: 'gpPct', label: 'Gross margin', kind: 'pct' },
    { id: 'ebitda', label: 'EBITDA', kind: 'usd', signed: true },
    { id: 'adjEbitdaPct', label: 'Adj. EBITDA margin', kind: 'pct' },
    { id: 'sellingPct', label: 'Selling expense', kind: 'pct', lowGood: true },
    { id: 'netNewArr', label: 'Net new ARR', kind: 'usd', signed: true },
    { id: 'cac', label: 'CAC', kind: 'usd2', lowGood: true },
    { id: 'ltvCac', label: 'LTV / CAC', kind: 'x' },
    { id: 'paybackMo', label: 'CAC payback', kind: 'mo', lowGood: true },
    { id: 'monthlyChurn', label: 'Monthly churn', kind: 'pct', lowGood: true },
  ];
  const monthLabel = new Date(closedYm + '-15T12:00').toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  return el('div', { class: 'card p-4' },
    el('div', { class: 'flex items-baseline justify-between gap-3 flex-wrap mb-3' },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Executive summary · ' + monthLabel + ' (last closed month)'),
        el('div', { class: 'text-[9px] uppercase tracking-widest mt-0.5', style: { color: 'var(--text-subtle)' } }, 'Deltas vs prior month · vs same month last year · YTD through ' + monthLabel)),
    ),
    el('div', { class: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
      ...tiles.map(t => {
        const v = cur[t.id];
        const col = t.signed && v != null ? { color: v < 0 ? '#DC2626' : '#5F6C5B' } : {};
        return el('div', { class: 'rounded-lg border p-3 cursor-help', style: { borderColor: 'var(--border)', background: 'var(--card-2)' }, title: PUTIS_KPI_TIPS[t.id] || '' },
          el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, t.label),
          el('div', { class: 'text-xl font-black tabular-nums mt-0.5', style: col }, _putisFmt(t.kind, v)),
          el('div', { class: 'flex items-center gap-2 mt-1 flex-wrap' },
            (() => { const d = _putisDelta(t.kind, v, prev[t.id], t.lowGood); return d ? el('span', { class: 'flex items-center gap-1' }, el('span', { class: 'text-[9px] text-muted-' }, 'MoM'), d) : null; })(),
            (() => { const d = ly ? _putisDelta(t.kind, v, ly[t.id], t.lowGood) : null; return d ? el('span', { class: 'flex items-center gap-1' }, el('span', { class: 'text-[9px] text-muted-' }, 'YoY'), d) : null; })()),
          el('div', { class: 'text-[10px] tabular-nums mt-1', style: { color: 'var(--text-muted)' } }, 'YTD ' + _putisFmt(t.kind, ytd[t.id])));
      })));
}

// Branch scorecard — one row per branch, the columns a PE reader scans first.
function putisBranchScorecard(M, U, yms, branches, title) {
  const COLS = [
    { id: 'revenue', label: 'Revenue', kind: 'usd' },
    { id: 'gpPct', label: 'GM %', kind: 'pct' },
    { id: 'ebitda', label: 'EBITDA', kind: 'usd', signed: true },
    { id: 'ebitdaPct', label: 'EBITDA %', kind: 'pct', signed: true },
    { id: 'adjEbitdaPct', label: 'Adj. %', kind: 'pct', signed: true, tip: PUTIS_KPI_TIPS.adjEbitdaPct },
    { id: 'gaPct', label: 'G&A %', kind: 'pct', lowGood: true },
    { id: 'jobs', label: 'Jobs', kind: 'int', tip: PUTIS_KPI_TIPS.jobs },
    { id: 'cogsPerJob', label: 'COGS/job', kind: 'usd2', lowGood: true, tip: PUTIS_KPI_TIPS.cogsPerJob },
    { id: 'active', label: 'Active accts', kind: 'int', tip: 'Active recurring accounts today (FieldRoutes).' },
    { id: 'arr', label: 'Active ARR', kind: 'usd' },
    { id: 'newSubs', label: 'New accts', kind: 'int', tip: 'Recurring accounts sold in the period.' },
    { id: 'netNewArr', label: 'Net new ARR', kind: 'usd', signed: true, tip: PUTIS_KPI_TIPS.netNewArr },
    { id: 'cac', label: 'CAC', kind: 'usd2', lowGood: true, tip: PUTIS_KPI_TIPS.cac },
    { id: 'ltvCac', label: 'LTV/CAC', kind: 'x', tip: PUTIS_KPI_TIPS.ltvCac },
    { id: 'paybackMo', label: 'Payback', kind: 'mo', lowGood: true, tip: PUTIS_KPI_TIPS.paybackMo },
    { id: 'monthlyChurn', label: 'Churn/mo', kind: 'pct', lowGood: true, tip: PUTIS_KPI_TIPS.monthlyChurn },
    { id: 'revPerActive', label: 'Rev/acct/mo', kind: 'usd2', tip: PUTIS_KPI_TIPS.revPerActive },
  ];
  const rows = branches.map(b => ({ name: b, m: putisMetrics(M, U, yms, [b]) }));
  const total = putisMetrics(M, U, yms, branches);
  const sortKey = state._putisScoreSort || 'revenue';
  const sortDir = state._putisScoreDir || 'desc';
  rows.sort((a, b) => { const va = a.m[sortKey], vb = b.m[sortKey]; const x = (va == null ? -Infinity : va), y = (vb == null ? -Infinity : vb); return sortDir === 'asc' ? x - y : y - x; });
  const topShare = total.revenue > 0 ? Math.max(...rows.map(r => r.m.revenue || 0)) / total.revenue : null;
  const th = (c) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap text-left cursor-pointer select-none', style: { color: sortKey === c.id ? 'var(--accent)' : 'var(--text-muted)' }, title: (c.tip || PUTIS_KPI_TIPS[c.id] || c.label) + ' · click to sort',
    onclick: () => { if (state._putisScoreSort === c.id) state._putisScoreDir = sortDir === 'asc' ? 'desc' : 'asc'; else { state._putisScoreSort = c.id; state._putisScoreDir = c.lowGood ? 'asc' : 'desc'; } mountApp(); } }, c.label);
  // Best / worst shading per column (excluding total) so the eye lands on outliers.
  const best = {}, worst = {};
  COLS.forEach(c => { const vals = rows.map(r => r.m[c.id]).filter(v => v != null && isFinite(v)); if (vals.length >= 3) { const hi = Math.max(...vals), lo = Math.min(...vals); best[c.id] = c.lowGood ? lo : hi; worst[c.id] = c.lowGood ? hi : lo; } });
  const td = (c, m, isTotal) => {
    const v = m[c.id];
    const st = {};
    if (!isTotal && v != null && isFinite(v)) { if (v === best[c.id]) st.background = 'rgba(95,108,91,.10)'; else if (v === worst[c.id]) st.background = 'rgba(220,38,38,.10)'; }
    if (c.signed && v != null) st.color = v < 0 ? '#DC2626' : '#5F6C5B';
    return el('td', { class: 'px-2 py-1.5 tabular-nums whitespace-nowrap' + (isTotal ? ' font-bold' : ''), style: st }, _putisFmt(c.kind, v));
  };
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-start justify-between gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, title),
        el('div', { class: 'text-[9px] uppercase tracking-widest mt-1', style: { color: 'var(--text-subtle)' } }, 'Green = best in column · red = worst · click a header to sort' + (topShare != null ? ' · top-branch concentration ' + _putisPct1(topShare) : ''))),
    ),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } },
      el('thead', {}, el('tr', {}, el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold text-left', style: { color: 'var(--text-muted)' } }, 'Branch'), ...COLS.map(th))),
      el('tbody', {},
        ...rows.map(r => el('tr', { class: 'border-t border-' }, el('td', { class: 'px-2 py-1.5 font-semibold whitespace-nowrap', style: { position: 'sticky', left: 0, background: 'var(--card)', zIndex: 1, boxShadow: '1px 0 0 var(--border)' } }, r.name), ...COLS.map(c => td(c, r.m, false)))),
        el('tr', { class: 'border-t font-bold', style: { background: 'var(--card-2)' } }, el('td', { class: 'px-2 py-1.5 whitespace-nowrap', style: { position: 'sticky', left: 0, background: 'var(--card-2)', zIndex: 1, boxShadow: '1px 0 0 var(--border)' } }, 'RIDD'), ...COLS.map(c => td(c, total, true)))))));
}

// ── Comparative income statement (the banker's page) ─────────────────────
// One month against the prior month and the same month last year, then YTD
// against prior YTD, then LTM — every $ line with its % of revenue
// underneath, every comparison as $ change and % change.
function putisComparativeCard(M, ym, branches, title, headerExtra, opts = {}) {
  const company = !!opts.company;
  const openYm = putisOpenMonth();
  const shift = (y, m, k) => { let yy = y, mm = m + k; while (mm < 1) { mm += 12; yy--; } while (mm > 12) { mm -= 12; yy++; } return yy + '-' + String(mm).padStart(2, '0'); };
  const [Y, Mo] = ym.split('-').map(Number);
  const prevYm = shift(Y, Mo, -1), lyYm = shift(Y, Mo, -12);
  const has = (k) => !!(M && M[k]);
  const one = (k) => has(k) ? putisAugment(putisDerive(M, k, branches), M, k, branches, company) : null;
  const _U = putisUnitMonthly();
  const span = (endK, n, floorK) => { const ks = []; for (let i = 0; i < n; i++) { const k = shift(...endK.split('-').map(Number), -i); if (floorK && k < floorK) break; if (has(k) && k < openYm) ks.push(k); } return ks.length ? { d: Object.assign(putisDeriveMonths(M, ks, branches), (() => { const um = putisMetrics(M, _U, ks, branches); const o = {}; for (const k of ['newSubs', 'newArr', 'renewals', 'expArr', 'lostArr', 'netNewArr', 'monthlyChurn', 'cac', 'mktgPerNew', 'acv', 'ltv', 'ltvCac', 'paybackMo']) o[k] = um[k]; return o; })()), n: ks.length, first: ks[ks.length - 1], last: ks[0] } : null; };
  const cur = one(ym), prev = one(prevYm), ly = one(lyYm);
  const ytd = span(ym, Mo, Y + '-01'), ytdLy = span(lyYm, Mo, (Y - 1) + '-01');
  const mon = (k, o) => new Date(k + '-15T12:00').toLocaleDateString('en-US', o);
  const rows = PUTIS_ROWS.filter(r => !r.company || company);
  const fmt = (row, v) => v == null || !isFinite(v) ? '—' : row.kind === 'pct' ? _putisPct1(v) : row.kind === 'x' ? v.toFixed(2) + 'x' : row.kind === 'mo' ? v.toFixed(1) + ' mo' : row.kind === 'int' ? Math.round(v).toLocaleString() : _putisUsd(v);
  const val = (row, d) => d ? ((row.point || row.unit) ? d[row.id] : (d.any ? d[row.id] : null)) : null;
  const th = (t, tip, o = {}) => el('th', { class: 'px-2 py-1.5 text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (o.left ? 'text-left' : 'text-right') + (tip ? ' cursor-help' : ''), style: { color: 'var(--text-muted)', position: 'sticky', top: 0, left: o.corner ? 0 : undefined, zIndex: o.corner ? 3 : 2, background: 'var(--card)', boxShadow: '0 1px 0 var(--border)', borderLeft: o.group ? '1px solid var(--border)' : undefined }, title: tip || '' }, t);
  // A value cell: $ (or %) with the % of revenue underneath for $ rows.
  const cell = (row, d, o = {}) => {
    const v = val(row, d);
    const node = el('div', { style: row.red && v > 0 ? { color: '#DC2626' } : row.signed && v != null ? { color: v < 0 ? '#DC2626' : '#5F6C5B' } : {} }, fmt(row, v));
    if (row.kind === 'usd' && !row.point && !row.unit && v != null && d && d.revenue > 0 && row.id !== 'revenue') node.append(el('div', { class: 'text-[9px] font-normal', style: { color: 'var(--text-subtle)' } }, _putisPct1(v / d.revenue) + ' of rev'));
    return el('td', { class: 'px-2 py-1 tabular-nums whitespace-nowrap text-right align-top' + (o.bold ? ' font-bold' : ''), style: { borderLeft: o.group ? '1px solid var(--border)' : undefined, opacity: o.dim ? '.55' : undefined } }, node);
  };
  // A change cell: $ change + % change (pts for % rows), coloured by good/bad.
  const delta = (row, a, b) => {
    const va = val(row, a), vb = val(row, b);
    if (va == null || vb == null || !isFinite(va) || !isFinite(vb)) return el('td', { class: 'px-2 py-1 text-right text-[11px]', style: { color: 'var(--text-subtle)' } }, '—');
    const d = va - vb;
    const good = row.lowGood ? d <= 0 : d >= 0;
    const color = Math.abs(d) < 1e-9 ? 'var(--text-subtle)' : good ? '#5F6C5B' : '#DC2626';
    const main = row.kind === 'pct' ? (d > 0 ? '+' : '') + (d * 100).toFixed(1) + ' pts' : row.kind === 'x' ? (d > 0 ? '+' : '') + d.toFixed(2) + 'x' : row.kind === 'int' ? (d > 0 ? '+' : '') + Math.round(d).toLocaleString() : (d > 0 ? '+' : '') + _putisUsd(d);
    const node = el('div', { class: 'text-[11px] font-semibold', style: { color } }, main);
    if (row.kind !== 'pct' && row.kind !== 'x' && Math.abs(vb) > 1e-9) node.append(el('div', { class: 'text-[9px] font-normal', style: { color } }, (d / Math.abs(vb) * 100).toFixed(1) + '%'));
    return el('td', { class: 'px-2 py-1 tabular-nums whitespace-nowrap text-right align-top' }, node);
  };
  const head = el('tr', {},
    th('', '', { left: true, corner: true }),
    th(mon(ym, { month: 'short', year: '2-digit' }), 'The selected month.', { group: true }),
    th(mon(prevYm, { month: 'short', year: '2-digit' }), 'The month before.'),
    th('MoM', 'Change from the prior month — $ (and %) or points.'),
    th(mon(lyYm, { month: 'short', year: '2-digit' }), 'The same month last year.', { group: true }),
    th('YoY', 'Change from the same month last year.'),
    th(Y + ' YTD', ytd ? 'Jan–' + mon(ytd.last, { month: 'short' }) + ' ' + Y + ' (' + ytd.n + ' closed month' + (ytd.n === 1 ? '' : 's') + ').' : 'No closed months yet.', { group: true }),
    th((Y - 1) + ' YTD', ytdLy ? 'The same months of ' + (Y - 1) + ' (' + ytdLy.n + ').' : 'Not in the feed.'),
    th('YoY', 'YTD change against the same months last year.'),
    th('YoY', 'YTD change against the same months last year.'));
  const body = rows.map(row => {
    if (row.head) return el('tr', {}, el('td', { colspan: '10', class: 'px-2 pt-3 pb-1 text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)', position: 'sticky', left: 0 } }, row.head));
    const isPt = !!row.point;   // unit rows roll up over the period like $ rows
    const pd = (s) => s ? s.d : null;
    const bold = !!row.bold;
    const tr = el('tr', { class: 'border-t border-' + (bold ? ' font-semibold' : ''), style: bold ? { background: 'var(--card-2)' } : {} },
      el('td', { class: 'px-2 py-1 whitespace-nowrap font-bold cursor-help', style: { position: 'sticky', left: 0, background: bold ? 'var(--card-2)' : 'var(--card)', zIndex: 1, boxShadow: '1px 0 0 var(--border)' }, title: row.tip || '' }, row.label),
      cell(row, cur, { bold, group: true, dim: ym === openYm }), cell(row, prev), delta(row, cur, prev),
      cell(row, ly, { group: true }), delta(row, cur, ly));
    if (isPt) {
      // Point-in-time rows have no YTD / LTM sum — show the period-end value once, no comparison.
      tr.append(el('td', { class: 'px-2 py-1 text-right', style: { borderLeft: '1px solid var(--border)', color: 'var(--text-subtle)' } }, '—'), el('td', {}, ''), el('td', {}, ''));
    } else {
      tr.append(cell(row, pd(ytd), { bold, group: true }), cell(row, pd(ytdLy)), delta(row, pd(ytd), pd(ytdLy)));
    }
    return tr;
  });
  return el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-5 py-3 border-b flex items-start gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('div', {}, el('h3', { class: 'text-sm font-bold' }, title + (ym === openYm ? ' · open month' : ''))),
      headerExtra || null),
    el('div', { class: 'scroll-x', style: { overflow: 'auto', maxHeight: '80vh' } }, el('table', { class: 'w-full text-xs frozen-table', style: { borderCollapse: 'collapse' } }, el('thead', {}, head), el('tbody', {}, ...body))));
}

function reportingPutis() {
  if (!isAdminRole(state.profile?.role)) return emptyCard('Admins only.');
  reportingLoadLedger();
  const M = putisMonthly();
  const wrap = el('div', { class: 'flex flex-col gap-4' });
  if (!M) {
    const failed = state._ledgerErr === 'unavailable';
    wrap.append(el('div', { class: 'card p-8 text-center' },
      failed ? null : el('span', { class: 'spinner', style: { width: '22px', height: '22px', marginBottom: '10px' } }),
      el('div', { class: 'text-sm font-bold' }, failed ? 'QuickBooks ledger unavailable' : 'Loading QuickBooks…'),
      el('div', { class: 'text-xs mt-1 text-muted-' }, failed ? 'The Windsor → QuickBooks feed didn’t answer. Check WINDSOR_API_KEY / the QuickBooks connection in Windsor, then retry.' : (state._ledgerErr === 'pulling' ? 'First pull of the ledger takes ~30s — this page refreshes itself.' : '')),
      failed ? el('button', { class: 'mt-3 rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => reportingLoadLedger(true) }, 'Retry') : null));
    return wrap;
  }
  const U = putisUnitMonthly();
  // ── One set of filters for the whole tab (per Isaac): Year + Range ──
  const closedYm = (() => { const c = putisLastClosedMonth(); if (M[c]) return c; const all = Object.keys(M).filter(k => /^\d{4}-\d{2}$/.test(k) && k < putisOpenMonth()).sort(); return all[all.length - 1] || c; })();
  const closedYr = closedYm.slice(0, 4);
  const ledgerYears = [...new Set(Object.keys(M).filter(k => /^\d{4}-\d{2}$/.test(k) && k < putisOpenMonth()).map(k => k.slice(0, 4)))].sort().reverse();
  if (!ledgerYears.length) ledgerYears.push(closedYr);
  const scYear = ledgerYears.includes(String(state._putisScoreYear)) ? String(state._putisScoreYear) : closedYr;
  const year = Number(scYear);
  const scMonthsAvail = Object.keys(M).filter(k => k.startsWith(scYear + '-') && k < putisOpenMonth()).sort();
  const lastAvail = scMonthsAvail[scMonthsAvail.length - 1] || (scYear === closedYr ? closedYm : scYear + '-12');
  let scRange = state._putisScoreRange;   // 'ytd' | 'YYYY-MM'
  if (!scRange || (scRange !== 'ytd' && !scMonthsAvail.includes(scRange))) scRange = scYear === closedYr ? closedYm : (scRange === 'ytd' ? 'ytd' : lastAvail);
  const monthName = (ym, o) => new Date(ym + '-15T12:00').toLocaleDateString('en-US', o);
  const branches = putisBranchesWithData(M, year);
  const opBranches = branches.filter(b => b !== 'Corporate');
  const branchSel = state._putisBranch && (branches.includes(state._putisBranch) || state._putisBranch === 'RIDD') ? state._putisBranch : 'RIDD';
  const monthsWithData = Object.keys(M).filter(ym => ym.startsWith(String(year)) && Object.values(M[ym]).some(x => x.revenue)).sort();
  const _isYtdPick = /^\d{4}-YTD$/.test(state._putisMonth || '');
  if (!state._putisMonth || (!_isYtdPick && !M[state._putisMonth])) {
    const closed = putisLastClosedMonth();
    const candidates = monthsWithData.filter(ym => ym <= closed);
    state._putisMonth = M[closed] ? closed : (candidates[candidates.length - 1] || monthsWithData[monthsWithData.length - 1] || closed);
  }
  const ytdMonths = Object.keys(M).filter(k => k.startsWith(closedYr + '-') && k <= closedYm).sort();
  const pulled = state.reportingLedger.pulledAt ? new Date(state.reportingLedger.pulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
  const sel = (val, opts, on) => el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => on(e.target.value) },
    ...opts.map(([v, l]) => el('option', { value: v, selected: v === val }, l)));
  const seg = (val, opts, on) => el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
    ...opts.map(([v, l]) => el('button', { class: 'px-2.5 py-1 text-[11px] font-semibold transition', style: val === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' }, onclick: () => on(v) }, l)));

  // ── 0. Toolbar ──
  const pickers = () => el('div', { class: 'inline-flex items-center gap-1.5' },
    sel(scYear, ledgerYears.map(y => [y, y]), (v) => { state._putisScoreYear = v; const avail = Object.keys(M).filter(k => k.startsWith(v + '-') && k < putisOpenMonth()).sort(); if (state._putisScoreRange !== 'ytd') state._putisScoreRange = v === closedYr ? closedYm : avail[avail.length - 1]; mountApp(); }),
    sel(scRange, [['ytd', scYear + ' YTD'], ...scMonthsAvail.slice().reverse().map(ym => [ym, monthName(ym, { month: 'long' })])], (v) => { state._putisScoreRange = v; mountApp(); }));
  const momToggle = () => sel(state._putisDelta === 'mom' || state._putisDelta === 'yoy' ? state._putisDelta : 'none', phone ? [['none', 'Δ off'], ['mom', 'MoM'], ['yoy', 'YoY']] : [['none', 'No change'], ['mom', 'MoM change'], ['yoy', 'YoY change']], (v) => { state._putisDelta = v; mountApp(); });
  // The toolbar pins under the app header once you scroll past it (per
  // Isaac): a spacer holds its place in the flow, the bar itself flips to
  // position:fixed. (main is overflow-x:hidden, which defeats sticky.)
  // Order (per Isaac): sync stamp + ↻ on the left, Year then Month on the right.
  const toolbar = el('div', { id: 'putisBar', class: 'flex items-center gap-2 flex-wrap' },
    el('span', { class: 'ml-auto inline-flex items-center gap-1.5 whitespace-nowrap' },
      el('span', { class: 'text-[10px] text-muted-' }, pulled ? 'Last QB sync: ' + pulled + (state.reportingLedger.refreshing ? ' · refreshing…' : '') : (state.reportingLedger.refreshing ? 'Syncing QB…' : '')),
      // Same box as the selects beside it (same padding / font / border).
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text-muted)', lineHeight: 'inherit' }, title: 'Re-pull the ledger from QuickBooks now', onclick: () => { reportingLoadLedger(true); if (typeof reportingLoadQboSpend === 'function') reportingLoadQboSpend(true); } }, '↻'),
      pickers()));
  const barSpacer = el('div', { id: 'putisBarSpacer' }, toolbar);
  wrap.append(barSpacer);
  const pinPutisBar = () => {
    const sp = document.getElementById('putisBarSpacer'), bar = document.getElementById('putisBar');
    if (!sp || !bar) return;
    const hdr = document.querySelector('.page-header');
    const headerH = hdr ? Math.round(hdr.getBoundingClientRect().bottom) : 60;
    if (!sp.style.height) sp.style.height = bar.offsetHeight + 'px';
    const pin = sp.getBoundingClientRect().top < headerH;
    if (pin && !bar._pinned) {
      bar._pinned = true;
      const r = sp.getBoundingClientRect();
      Object.assign(bar.style, { position: 'fixed', top: headerH + 'px', left: r.left + 'px', width: r.width + 'px', zIndex: '15', background: 'var(--bg)', padding: '8px 0', borderBottom: '1px solid var(--border)' });
    } else if (!pin && bar._pinned) {
      bar._pinned = false;
      Object.assign(bar.style, { position: '', top: '', left: '', width: '', zIndex: '', background: '', padding: '', borderBottom: '' });
    } else if (pin) { const r = sp.getBoundingClientRect(); bar.style.left = r.left + 'px'; bar.style.width = r.width + 'px'; }
  };
  setTimeout(pinPutisBar, 0);
  if (!window._putisBarBound) {
    window._putisBarBound = true;
    window.addEventListener('scroll', () => { try { pinPutisBar(); } catch {} }, { passive: true });
    window.addEventListener('resize', () => { try { const sp = document.getElementById('putisBarSpacer'); if (sp) sp.style.height = ''; pinPutisBar(); } catch {} });
  }

  // (Executive-summary KPI strip retired per Isaac — the branch scorecard
  // carries the same ratios per branch + RIDD.)

  // ── 1. Trend (month-by-month, one scope at a time; RIDD by default) ──
  const sub = 'QuickBooks general ledger · months with nothing booked show —';
  // Branch picker = a CHECKLIST dropdown (per Isaac): every branch on by
  // default (= RIDD); untick any to drop it from the Metrics roll-up.
  const allBranches = branches.slice();
  let picked = Array.isArray(state._putisBranches) ? state._putisBranches.filter(b => allBranches.includes(b)) : null;
  if (!picked || !picked.length) picked = allBranches.slice();
  const pickedSet = new Set(picked);
  const allOn = picked.length === allBranches.length;
  const branchPicker = () => {
    const label = allOn ? 'RIDD' : picked.length === 1 ? picked[0] : picked.length <= 2 ? picked.join(' + ') : picked[0] + ' + ' + (picked.length - 1) + ' more';
    const wrapB = el('div', { class: 'relative inline-flex' });
    const btn = el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer inline-flex items-center gap-1.5', style: { borderColor: allOn ? 'var(--border-2)' : 'var(--accent)', background: 'var(--card)', color: 'var(--text)' }, title: 'Branches in this roll-up' },
      label, el('span', { style: { fontSize: '9px', opacity: .7 } }, '\u25bc'));
    const panel = el('div', { class: 'card', style: { position: 'absolute', right: 0, top: 'calc(100% + 6px)', zIndex: 60, minWidth: '200px', padding: '6px', display: 'none', boxShadow: 'var(--shadow-lg)' } });
    const commit = (next) => { state._putisBranches = next.length === allBranches.length ? null : next; mountApp(); };
    const row = (name, on, onclick) => el('label', { class: 'flex items-center gap-2 px-2 py-1 rounded-lg text-[11px] font-medium cursor-pointer', style: { color: 'var(--text)' }, onmouseenter: (e) => { e.currentTarget.style.background = 'var(--card-2)'; }, onmouseleave: (e) => { e.currentTarget.style.background = 'transparent'; } },
      el('input', { type: 'checkbox', checked: on, class: 'accent-lime', onchange: onclick }), name);
    panel.append(
      el('div', { class: 'flex items-center justify-between px-2 pb-1 mb-1 border-b', style: { borderColor: 'var(--border)' } },
        el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Branches'),
        el('div', { class: 'flex gap-2' },
          el('button', { class: 'text-[10px] font-semibold', style: { color: 'var(--accent)' }, onclick: (e) => { e.stopPropagation(); commit(allBranches.slice()); } }, 'All'),
          el('button', { class: 'text-[10px] font-semibold', style: { color: 'var(--text-muted)' }, onclick: (e) => { e.stopPropagation(); commit([allBranches[0]]); } }, 'None'))),
      ...allBranches.map(b => row(b, pickedSet.has(b), () => { const next = pickedSet.has(b) ? picked.filter(x => x !== b) : [...picked, b]; if (!next.length) return; commit(allBranches.filter(x => next.includes(x))); })));
    btn.onclick = (e) => {
      e.stopPropagation();
      const open = panel.style.display === 'block';
      panel.style.display = open ? 'none' : 'block';
      if (!open) setTimeout(() => document.addEventListener('mousedown', function closer(ev) { if (wrapB.contains(ev.target)) return; panel.style.display = 'none'; document.removeEventListener('mousedown', closer); }), 0);
    };
    wrapB.append(btn, panel);
    return wrapB;
  };
  // Two ways to read it: the 12-month strip (Monthly) or the banker's
  // comparative statement (Compare: month vs prior month / same month LY,
  // YTD vs prior YTD, LTM vs prior LTM).
  // Phones (per Isaac): one column at a time everywhere — a branch dropdown
  // (RIDD default) on each card, no Compare toggle on the trend table.
  const phone = (() => { try { return window.matchMedia('(max-width: 640px)').matches; } catch { return false; } })();
  const view = 'monthly';   // (Compare view retired per Isaac — MoM / YoY change lives in the Monthly table)
  const closedAll = Object.keys(M).filter(k => /^\d{4}-\d{2}$/.test(k) && k < putisOpenMonth()).sort();
  let cmpYm = state._putisCmpMonth; if (!cmpYm || !M[cmpYm]) cmpYm = closedYm;
  const monthPick = () => sel(cmpYm, closedAll.slice().reverse().map(k => [k, new Date(k + '-15T12:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })]), (v) => { state._putisCmpMonth = v; mountApp(); });
  const viewSeg = () => seg(view, [['monthly', 'Monthly'], ['compare', 'Compare']], (v) => { state._putisView = v; mountApp(); });
  // Range for the Monthly table: all 12 months across, or one month beside
  // its YTD (phones default to the last closed month).
  const closedThisYear = closedAll.filter(k => k.startsWith(String(year) + '-'));
  let trendRange = state._putisRange;
  if (trendRange !== 'all' && !closedThisYear.includes(trendRange)) trendRange = phone ? (closedThisYear[closedThisYear.length - 1] || 'all') : 'all';
  const rangePick = () => sel(trendRange, [['all', 'All months'], ...closedThisYear.slice().reverse().map(k => [k, new Date(k + '-15T12:00').toLocaleDateString('en-US', { month: phone ? 'short' : 'long', year: 'numeric' })])], (v) => { state._putisRange = v; mountApp(); });
  const trendHeader = () => { const h = el('div', { class: 'ml-auto inline-flex items-center gap-1.5 flex-wrap' }, momToggle(), rangePick(), branchPicker()); h.lastChild && h.lastChild.classList.remove('ml-auto'); return h; };
  const scopeSet = picked;
  const scopeOpts = allOn ? { company: true } : {};
  if (view === 'compare') wrap.append(putisComparativeCard(M, cmpYm, scopeSet, 'P&L Metrics', trendHeader(), scopeOpts));
  else wrap.append(putisTrendCard(M, year, scopeSet, 'Metrics', sub, trendHeader(), { ...scopeOpts, compact: phone, range: trendRange }));

  // ── 2. P&L Indicators (year dropdown + range dropdown: YTD or a single month) ──
  const scKey = scRange === 'ytd' ? scYear + '-YTD' : scRange;
  const scBranches = scRange === 'ytd' ? putisBranchesWithData(M, scYear) : putisBranchesWithData(M, scYear).filter(b => M[scRange] && M[scRange][b]);
  // Recurring book is its own card at the very top of the tab (above the
  // trend table); the income statement stays here. Both share the pickers.
  const colSel = state._putisCol && (scBranches.includes(state._putisCol) || state._putisCol === 'RIDD') ? state._putisCol : 'RIDD';
  const colPicker = () => sel(colSel, [['RIDD', 'RIDD'], ...scBranches.map(b => [b, b])], (v) => { state._putisCol = v; mountApp(); });
  const cardHeader = () => phone ? colPicker() : null;   // filters live in the toolbar now
  const cardOpts = (section) => ({ section, headerExtra: cardHeader(), onlyCol: phone ? colSel : null, compact: phone });
  const anchor = wrap.children[1] || null;
  for (const part of ['book', 'margins', 'unit']) wrap.insertBefore(putisIndicatorsCard(M, scKey, scBranches, cardOpts(part)), anchor);
  wrap.append(putisIndicatorsCard(M, scKey, scBranches, cardOpts('pnl')));
  // Data-advantage cards (per Isaac): source unit economics + add-on performance.
  try { const a = intelSourceEconomicsCard(); if (a) wrap.append(a); const b = intelAddonCard(); if (b) wrap.append(b); } catch (e) { console.warn('[putis] intel cards skipped', e); }

  return wrap;
}

function reportingSubTabs() {
  const tabs = [
    ['overview',   'Overview'],
    ['geographic', 'Geographic'],
    ['waterfall',  'Retention'],
    ['auditing',   'Auditing'],
    ['marketing',  'Marketing'],
    ['ops',        'Operations'],
    ['putis',      'P&L'],
  ];
  const go = (k) => { const t = tabs.find(([kk]) => kk === k); if (t && t[2]) { window.open(t[2], '_blank', 'noopener'); return; } state.reportingSubTab = k; mountApp(); };
  const cur = tabs.some(([k]) => k === state.reportingSubTab && !tabs.find(([kk]) => kk === k)[2]) ? state.reportingSubTab : tabs[0][0];
  // Desktop: the tab strip. Phones: one dropdown (the strip had grown past
  // the screen width) — CSS in index.html swaps them at 640px.
  const strip = el('div', { class: 'rpt-subtabs flex items-center gap-1 border-b overflow-x-auto', style: { borderColor: 'var(--border)' } },
    ...tabs.map(([k, label]) => {
      const active = cur === k;
      // Marketing carries a small red bubble with the Needs-attention count (per Isaac, Sep 2026) — owner only, like the card.
      let badge = null;
      if (k === 'marketing' && typeof exceptionFeedScope === 'function' && typeof exceptionFeedItems === 'function') {
        try { const sc = exceptionFeedScope(); const n = sc ? exceptionFeedItems(sc).length : 0; if (n) badge = el('span', { class: 'inline-flex items-center justify-center rounded-full text-[9px] font-bold ml-1', title: n + ' item' + (n === 1 ? '' : 's') + ' need attention', style: { background: '#DC2626', color: '#fff', minWidth: '16px', height: '16px', padding: '0 4px', lineHeight: '16px' } }, String(n)); } catch (e) { /* badge is optional */ }
      }
      return el('button', {
        class: 'px-2.5 py-1 text-[11px] font-semibold transition whitespace-nowrap inline-flex items-center',
        style: {
          borderBottom: active ? '2px solid var(--accent)' : '2px solid transparent',
          color: active ? 'var(--text)' : 'var(--text-muted)',
          background: active ? 'rgba(223,100,58,.10)' : 'transparent',   // super-light orange on the open tab (per Isaac)
          borderRadius: '6px 6px 0 0',
          marginBottom: '-1px',
        },
        onclick: () => go(k),
      }, label, badge);
    }),
  );
  const pick = el('div', { class: 'rpt-subtabs-select' },
    el('select', {
      class: 'w-full rounded-lg border px-3 py-2 text-sm font-semibold cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
      onchange: (e) => { const k = e.target.value; go(k); if (tabs.find(([kk]) => kk === k)[2]) e.target.value = cur; },
    }, ...tabs.map(([k, label]) => el('option', { value: k, selected: cur === k }, label))));
  return el('div', {}, strip, pick);
}

// Common "do we have data to show" gate. Returns either an early-return
// node OR null when the caller has data to render. Centralizes the three
// snapshot states (none / loading / DEMO-rows-missing) so every data
// sub-tab handles them the same way.
function reportingDataGate() {
  const activeId = state.reportingActiveUploadId;
  if (!activeId) {
    return emptyCard('No snapshot loaded yet — the scheduled sync (hourly during the day) pulls the latest from RevHawk automatically.');
  }
  if (state.reportingSubscriptionsLoadedFor !== activeId) {
    return emptyCard('Loading snapshot…');
  }
  if (DEMO && (state.reportingSubscriptions || []).length === 0) {
    return el('div', { class: 'card p-12 text-center flex flex-col gap-2' },
      el('div', { class: 'text-sm font-semibold' }, 'Snapshot metadata restored, but rows aren’t persisted in demo mode.'),
      el('div', { class: 'text-xs text-muted-' }, 'Re-upload the CSV to populate the Overview and charts. (Configurations did persist.)'),
    );
  }
  return null;
}

// Compute the active filter scope — office + date + compare state — and
// the row sets each panel needs. Shared across every data sub-tab so
// they all filter the same way.
function reportingScope(opts = {}) {
  // Office-compare is a Waterfall-only feature now — clear it anywhere else
  // so no tab is stranded in compare with no exit control.
  if (state.reportingCompareMode && state.reportingSubTab !== 'waterfall') state.reportingCompareMode = false;
  const { visible } = reportingFilters();
  // Office list built from ALL dates so changing the time filter doesn't
  // make offices disappear from the picker (would be jarring if the
  // user lost their selection).
  const offices = reportingOfficeList(visible);
  // opts.allOffices: the tab has no office control (Geographic — the map IS
  // the office breakdown), so a selection made on another tab must not
  // silently narrow it.
  const office  = opts.allOffices ? 'all' : (state.reportingOffice || 'all');
  const inCompare = !!state.reportingCompareMode;
  const compareOffice = state.reportingCompareOffice || 'all';
  const datePreset = state.reportingDateRange || 'all';
  const { start: dateStart, end: dateEnd } = reportingDateBounds(
    datePreset, state.reportingDateStart, state.reportingDateEnd,
  );
  const inDate = reportingFilterByDate(visible, dateStart, dateEnd);
  const dateLabel = reportingDateRangeLabel(datePreset, dateStart, dateEnd);
  // Time filter applies before office filter.
  const scopeA = reportingFilterByOffice(inDate, office);
  const scopeB = inCompare ? reportingFilterByOffice(inDate, compareOffice) : null;
  return {
    visible, offices, office, compareOffice, inCompare,
    datePreset, dateStart, dateEnd, dateLabel, inDate,
    scopeA, scopeB,
    officeLabel: (o) => o === 'all' ? 'All Offices' : o === 'multi' ? ((state.reportingOffices || []).length + ' branches') : o,
  };
}

// Render the shared filter bar (office picker(s) + time range + compare
// toggle + active-filter summary). Every data sub-tab calls this so
// filter UX is consistent.
function reportingFilterBar(scope, opts = {}) {
  const showDate    = opts.showDate    !== false;   // default: show the time range
  const showCompare = opts.showCompare === true;    // default: no compare button
  const showOffice  = opts.showOffice  !== false;   // default: show the office picker
  const { offices, office, compareOffice, inCompare, datePreset, dateStart, dateEnd, dateLabel, inDate } = scope;

  // Office A is a CHECKLIST (per Isaac, Sep 2026): every branch ticked by
  // default, untick to drop one — the selection lives in state.reportingOffices
  // and reportingFilterByOffice reads it as office === 'multi'.
  const officeChecklist = (hint) => {
    const all = offices.slice();
    const picked = new Set(state.reportingOffice === 'multi' && Array.isArray(state.reportingOffices) ? state.reportingOffices : (state.reportingOffice && state.reportingOffice !== 'all' ? [state.reportingOffice] : all));
    const allOn = all.every(o => picked.has(o));
    const commit = (set) => {
      const arr = all.filter(o => set.has(o));
      if (arr.length === all.length) { state.reportingOffice = 'all'; state.reportingOffices = null; }
      else if (arr.length === 1) { state.reportingOffice = arr[0]; state.reportingOffices = null; }
      else { state.reportingOffice = 'multi'; state.reportingOffices = arr; }
      state._rptOfficeOpen = true; mountApp();
    };
    const wrap = el('div', { class: 'relative' });
    const panel = el('div', { class: 'card absolute p-1.5', style: { top: 'calc(100% + 6px)', left: '0', minWidth: '220px', maxHeight: '320px', overflowY: 'auto', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: state._rptOfficeOpen ? 'block' : 'none' } },
      el('div', { class: 'flex items-center gap-1 px-1.5 pb-1.5 mb-1', style: { borderBottom: '1px solid var(--border)' } },
        ...[['All', () => commit(new Set(all))], ['None', () => commit(new Set())]].map(([l, fn]) => el('button', { class: 'rounded-lg px-2 py-0.5 text-[10px] font-bold', style: { background: 'var(--card-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }, onclick: (e) => { e.stopPropagation(); fn(); } }, l))),
      ...all.map(o => {
        const on = picked.has(o);
        const cb = el('input', { type: 'checkbox', checked: on, style: { accentColor: 'var(--accent)' }, onclick: (e) => e.stopPropagation(), onchange: (e) => { const n = new Set(picked); if (e.target.checked) n.add(o); else n.delete(o); commit(n); } });
        cb.checked = on;
        return el('label', { class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer transition hover:brightness-95', style: { color: 'var(--text)', background: on ? 'var(--card-2)' : 'transparent' }, onclick: (e) => e.stopPropagation() }, cb, el('span', { class: 'flex-1 truncate' }, o));
      }));
    const label = allOn ? 'All Offices' : picked.size === 0 ? 'No offices' : picked.size === 1 ? [...picked][0] : picked.size + ' of ' + all.length + ' offices';
    const btn = el('button', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer flex items-center justify-between gap-2',
      style: { borderColor: allOn ? 'var(--border-2)' : 'var(--accent)', background: 'var(--card)', color: 'var(--text)', minWidth: '180px' },
      onclick: (e) => {
        e.stopPropagation();
        const open = panel.style.display === 'block';
        panel.style.display = open ? 'none' : 'block'; state._rptOfficeOpen = !open;
        if (!open) { try { clampDropdownPanel(panel); } catch (err) { /* helper optional */ } setTimeout(() => document.addEventListener('mousedown', function closer(ev) { if (!wrap.contains(ev.target)) { panel.style.display = 'none'; state._rptOfficeOpen = false; document.removeEventListener('mousedown', closer); } }), 0); }
      },
    }, el('span', { class: 'truncate' }, label), el('span', { style: { fontSize: '9px', opacity: .7 } }, '\u25BE'));
    if (state._rptOfficeOpen) { try { clampDropdownPanel(panel); } catch (err) { /* optional */ } setTimeout(() => document.addEventListener('mousedown', function closer(ev) { if (!wrap.contains(ev.target)) { panel.style.display = 'none'; state._rptOfficeOpen = false; document.removeEventListener('mousedown', closer); } }), 0); }
    wrap.append(btn, panel);
    return el('div', { class: 'flex flex-col gap-1 rep-filter-pick' },
      hint && el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, hint),
      wrap);
  };
  const officePicker = (selected, onChange, hint) => {
    const sel = el('select', {
      class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
      style: { borderColor: 'var(--border-2)', background: 'var(--card)', minWidth: '180px' },
      onchange: (e) => onChange(e.target.value),
    },
      el('option', { value: 'all', selected: selected === 'all' }, 'All Offices'),
      ...offices.map(o => el('option', { value: o, selected: selected === o }, o)),
    );
    return el('div', { class: 'flex flex-col gap-1 rep-filter-pick' },
      hint && el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, hint),
      sel,
    );
  };

  const compareBtn = el('button', {
    // Sized to match the pickers beside it (same font/padding as the selects)
    class: 'rounded-lg px-2.5 py-1 text-[11px] font-semibold transition hover:brightness-95 self-end',
    style: inCompare
      ? { background: 'var(--card-2)', color: 'var(--text)', border: '1px solid var(--border)' }
      : { background: 'var(--accent)', color: 'var(--accent-text)' },
    onclick: () => {
      state.reportingCompareMode = !inCompare;
      // Default the B picker to a different office than A on first open
      // so the comparison is meaningful out of the gate.
      if (!inCompare && state.reportingCompareOffice === office) {
        state.reportingCompareOffice = offices.find(o => o !== office) || 'all';
      }
      mountApp();
    },
  }, inCompare ? '✕ Exit' : 'Compare');
  const methodologyInfo = (typeof reportingMethodologyInfoBtn === 'function') ? reportingMethodologyInfoBtn() : null;

  const datePresets = [
    ['all',             'All time'],
    ['ytd',             'Year to date'],
    ['last_12_months',  'Last 12 months'],
    ['last_year',       'Last year'],
    ['custom',          'Custom range…'],
  ];
  const datePicker = el('div', { class: 'flex flex-col gap-1 rep-filter-pick' },
    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Time range'),
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('select', {
        class: 'rounded-lg border px-2.5 py-1 text-[11px] cursor-pointer',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', minWidth: '170px' },
        onchange: (e) => {
          state.reportingDateRange = e.target.value;
          // Default custom inputs to the previously-resolved bounds so
          // the user starts from a sensible position instead of blank.
          if (e.target.value === 'custom') {
            if (!state.reportingDateStart) state.reportingDateStart = dateStart || '';
            if (!state.reportingDateEnd)   state.reportingDateEnd   = dateEnd   || '';
          }
          mountApp();
        },
      },
        ...datePresets.map(([v, label]) => el('option', { value: v, selected: datePreset === v }, label)),
      ),
      datePreset === 'custom' && el('input', {
        type: 'date',
        class: 'rounded-lg border px-2.5 py-1 text-[11px]',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
        value: state.reportingDateStart || '',
        onchange: (e) => { state.reportingDateStart = e.target.value; mountApp(); },
      }),
      datePreset === 'custom' && el('span', { class: 'text-xs', style: { color: 'var(--text-muted)' } }, '→'),
      datePreset === 'custom' && el('input', {
        type: 'date',
        class: 'rounded-lg border px-2.5 py-1 text-[11px]',
        style: { borderColor: 'var(--border-2)', background: 'var(--card)' },
        value: state.reportingDateEnd || '',
        onchange: (e) => { state.reportingDateEnd = e.target.value; mountApp(); },
      }),
    ),
  );

  const filterSummary = el('div', {
    class: 'text-[11px] mt-1 flex items-center gap-2 flex-wrap',
    style: { color: 'var(--text-muted)' },
  },
    (dateStart || dateEnd) && el('button', {
      class: 'underline ml-1 text-[11px]',
      style: { color: 'var(--accent)', background: 'transparent', border: 'none', cursor: 'pointer' },
      onclick: () => {
        state.reportingDateRange = 'all';
        state.reportingDateStart = '';
        state.reportingDateEnd   = '';
        mountApp();
      },
    }, 'Clear time filter'),
  );

  // Phones (rep-filter-row CSS): pickers share one row with the ⓘ hugging
  // the right edge instead of wrapping underneath (per Isaac).
  return el('div', { class: 'card p-4 flex flex-col gap-2' },
    el('div', { class: 'flex items-end gap-3 flex-wrap rep-filter-row' },
      showOffice && (inCompare ? officePicker(office, (v) => { state.reportingOffice = v; mountApp(); }, 'Office A') : officeChecklist('Office')),
      showOffice && inCompare && el('div', { class: 'text-sm font-bold self-end pb-2', style: { color: 'var(--text-muted)' } }, 'vs'),
      showOffice && inCompare && officePicker(compareOffice, (v) => { state.reportingCompareOffice = v; mountApp(); }, 'Office B'),
      showDate && datePicker,
      showCompare && compareBtn,
      el('div', { class: 'flex-1 rep-filter-spacer' }),
      methodologyInfo,
    ),
    filterSummary,
  );
}

