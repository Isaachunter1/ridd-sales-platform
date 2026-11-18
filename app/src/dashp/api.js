// ┌─ dashp/api ───────────────────────────────────────────────────────────────
// │ COMMISSIONS (DASHP) — the data half. Technician and Sales Rep commission
// │ results are computed on DASHP (a separate platform, refreshed hourly) and
// │ read through this app's own server at /api/dashp/* (server/services/dashp —
// │ a pass-through that adds the API key; admins and developers only).
// │
// │ This file is the ONLY place that knows DASHP's response shapes:
// │   dashpLoad(path)            fetch + cache one read, re-render when it lands
// │   dashpTechDetail(results)   one technician, one quarter  → plain view data
// │   dashpD2dDetail(results)    one sales rep, one year      → plain view data
// │ The screens (technicians.js, d2d.js) only read what these return, so a
// │ change to what is shown never has to touch the fetching, and a change on
// │ DASHP's side is absorbed here. The list responses (one row per person) are
// │ DASHP's stable contract and are used as they come.
// │
// │ Nothing is calculated here: every dollar figure is DASHP's own.
// └────────────────────────────────────────────────────────────────────────

const DASHP_CACHE_MS = 5 * 60 * 1000;   // DASHP recalculates hourly and allows 60 requests a minute across everyone
const DASHP_RETRY_MS = 20 * 1000;       // a failed read is retried on the next render after this

// Everything the Commissions screens remember lives here (never in top-level state keys).
function dashpStore() {
  state.modules = state.modules || {};
  const S = state.modules.dashp = state.modules.dashp || {};
  S.cache = S.cache || {}; S.sort = S.sort || {}; S.search = S.search || {}; S.filter = S.filter || {}; S.open = S.open || {};
  return S;
}

// One read. Returns a slot straight away: { status: 'loading' | 'ok' | 'empty' | 'error', data, error }.
// 'empty' = DASHP has no stored result for that person and period (its 404) — an empty state, not an error.
function dashpLoad(path) {
  const S = dashpStore();
  const cur = S.cache[path];
  if (cur && (cur.status === 'loading' || Date.now() - cur.at < (cur.status === 'error' ? DASHP_RETRY_MS : DASHP_CACHE_MS))) return cur;
  const slot = S.cache[path] = { status: 'loading', data: null, error: null, at: Date.now() };
  _apiAuthHeaders({ accept: 'application/json' })
    .then(h => fetch('/api/dashp/' + path, { headers: h }))
    .then(r => r.json().catch(() => null).then(j => ({ code: r.status, j })))
    .then(({ code, j }) => {
      if (code === 200 && j && j.ok) { slot.status = 'ok'; slot.data = j.data; }
      else if (code === 404 && j && j.error === 'commission_not_found') slot.status = 'empty';
      else { slot.status = 'error'; slot.error = dashpErrorText(code, j); }
    })
    .catch(e => { slot.status = 'error'; slot.error = 'Could not reach the server (' + String((e && e.message) || e) + ').'; })
    .then(() => { slot.at = Date.now(); if (state.view === 'dashp') mountApp(); });
  return slot;
}

function dashpErrorText(code, j) {
  if (code === 429) return 'Commission data is busy right now — try again in ' + ((j && j.retry_after_seconds) || 60) + ' seconds.';
  if (code === 401) return 'Your session expired — sign in again.';
  if (code === 403) return 'Your account can’t view commission data (admins only).';
  if (code === 503 && j && j.error === 'dashp_not_configured') return 'Commission data isn’t connected yet (the server is missing its DASHP settings).';
  return (j && (j.message || j.error)) || ('Commission data is unavailable (HTTP ' + code + ').');
}

// Drop every cached read (the Refresh button). The server keeps its own 5-minute copy.
function dashpRefresh() { dashpStore().cache = {}; mountApp(); }

// ── Small coercions: a field DASHP left out reads as 0 / '' / false, never a crash ──
function dashpNum(v) { const n = Number(v); return isFinite(n) ? n : 0; }
function dashpStr(v) { return v == null ? '' : String(v); }
function dashpObj(v) { return v && typeof v === 'object' ? v : {}; }
function dashpArr(v) { return Array.isArray(v) ? v : []; }

// Why a sale did not qualify / why a clawback came back — DASHP's codes in plain words.
const DASHP_REASONS = {
  manager_rejected: 'Manager rejected', reverted_to_original: 'Canceled — reverted', changed_not_active: 'Subscription changed',
  not_active: 'Not active', not_serviced: 'Not serviced', not_apay: 'Not on autopay', has_balance: 'Has balance', no_current_record: 'No current record',
  now_serviced: 'Now serviced', now_active: 'Reactivated', now_apay: 'Now on autopay', balance_cleared: 'Balance cleared', manager_approved: 'Manager approved', restored: 'Restored',
};
function dashpReason(code) { const c = dashpStr(code); return c ? (DASHP_REASONS[c] || c.replace(/_/g, ' ')) : ''; }

// "Passed Audit" (sales reps) and "passed_audit" (technicians) are the same thing; "-" is none.
function dashpAudit(v) {
  const k = dashpStr(v).trim().toLowerCase().replace(/\s+/g, '_');
  return { passed_audit: 'Passed audit', failed_audit: 'Failed audit', flagged: 'Flagged', pending_review: 'Pending review' }[k] || '';
}
function dashpCategory(v) { const s = dashpStr(v).trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : ''; }

// One sale (either kind) → the row the sales table draws.
function dashpSale(raw) {
  const r = dashpObj(raw), q = dashpObj(r.qualifiers);
  const flag = (k) => (q[k] == null ? null : q[k] === true || q[k] === 'true');   // null = DASHP did not send it → a grey chip, not a red one
  const source = dashpStr(r.source);
  return {
    ok: r.qualified === true || r.qualified === 'true',
    customer: dashpStr(r.customerName) || 'Customer', customerId: dashpStr(r.customerId),
    subscription: dashpStr(r.subscription || r.serviceType), category: dashpCategory(r.commissionCategory), audit: dashpAudit(r.auditStatus),
    sold: dashpStr(r.dateSold), soldLabel: dashpStr(r.dateSoldDisplay || r.dateSold),
    contract: dashpNum(r.contractValue != null ? r.contractValue : r.contractValueRaw),
    commission: r.commission == null ? null : dashpNum(r.commission),             // technicians only — DASHP has no per-sale amount for sales reps
    kind: source ? (/upsell/i.test(source) ? 'upsell' : 'personal') : '',         // technicians only
    upfrontPaid: r.upfrontPaid === true,                                           // technicians only: the upfront advance was paid on this job
    reason: dashpReason(r.disqualificationReason) || (r.upsellStatus === 'manager_approved' ? 'Manager approved' : ''),
    serviced: flag('serviced'), active: flag('active'), apay: flag('apay'), noBalance: flag('no_balance'), balance: dashpNum(r.balance != null ? r.balance : r.balanceRaw),
    office: dashpStr(r.officeName), months: dashpNum(r.agreementLengthMonths),     // sales reps only
  };
}

// A clawback or reverse clawback: a job from an earlier quarter that stopped (or started again) qualifying.
function dashpAdjustment(raw) {
  const r = dashpObj(raw), sp = dashpObj(r.soldPeriod);
  return {
    blocked: r.blocked === true,                                                   // prevented — no money moved, so it is not listed
    customer: dashpStr(r.customerName) || 'Customer', customerId: dashpStr(r.customerId),
    subscription: dashpStr(r.subscription || r.serviceType),
    amount: dashpNum(r.amount != null ? r.amount : r.commission),
    basis: { upfront: 'Upfront', commission: 'Full commission' }[dashpStr(r.amountBasis)] || '',
    soldIn: sp.year && sp.quarter ? 'Q' + sp.quarter + ' ' + sp.year : '',
    reason: dashpReason(r.requalificationReason || r.disqualificationReason),
    contract: dashpNum(r.contractValue),
  };
}

function dashpVolume(v) { const t = dashpObj(v); return { n: dashpNum(t.count), dollars: dashpNum(t.dollars), q: dashpNum(t.qualifiedCount), qDollars: dashpNum(t.qualifiedDollars) }; }

// GET technician-commission → results (one technician, one quarter). null in = null out.
function dashpTechDetail(results) {
  if (!results || typeof results !== 'object') return null;
  const r = results, c = dashpObj(r.commission), t = dashpObj(r.totals), d = dashpObj(r.deductions);
  const paid = dashpObj(d.alreadyPaid), claw = dashpObj(d.clawbacks), rev = dashpObj(r.reverseClawbacks);
  const manual = dashpObj(d.carryover || d.manual);   // office-entered deductions for this quarter; DASHP files them under "carryover"
  const rows = (list) => dashpArr(list).map(dashpAdjustment).filter(a => !a.blocked);
  return {
    name: dashpStr(dashpObj(r.rep).name) || 'Technician', eligible: dashpObj(r.rep).eligible !== false,
    rate: dashpNum(c.commissionPercent), gross: dashpNum(c.grossCommission), personalGross: dashpNum(c.personalGross), upsellGross: dashpNum(c.upsellGross), net: dashpNum(c.netPayout),
    total: dashpVolume(t.all), personal: dashpVolume(t.personal), upsells: dashpVolume(t.upsells),
    paid: { total: dashpNum(paid.total), months: dashpArr(paid.byMonth).map(m => ({ label: dashpStr(dashpObj(m).label), amount: dashpNum(dashpObj(m).amount), jobs: dashpNum(dashpObj(m).sale_count) })) },
    clawbacks: { total: dashpNum(claw.total), rows: rows(claw.rows) },
    reverse: { total: dashpNum(rev.total), rows: rows(rev.rows) },
    manual: { total: dashpNum(manual.total), rows: dashpArr(manual.rows).map(m => ({ title: dashpStr(dashpObj(m).title) || 'Adjustment', amount: dashpNum(dashpObj(m).amount), note: dashpStr(dashpObj(m).employee_note || dashpObj(m).employeeNote) })) },
    sales: dashpArr(r.salesDetail).map(dashpSale),
  };
}

// GET d2d-commission → results (one sales rep, one year). null in = null out.
function dashpD2dDetail(results) {
  if (!results || typeof results !== 'object') return null;
  const r = results, k = dashpObj(r.kpis), a = dashpObj(r.audit), s = dashpObj(r.calcSteps), my = dashpObj(r.multiYear), c = dashpObj(r.commission);
  const step = (key) => (s[key] == null ? null : dashpNum(s[key]));
  const steps = [step('1_totalExpectedCommission'), step('2_totalAfterAttrition'), step('3_totalAfterMultiYearDeduct'), step('4_totalAfterFailedAuditDeduct'), step('5_totalAfterDeductTable')];
  const cat = (id, label) => ({ label, revenue: dashpNum(c[id + 'RevenueTotal']), qualified: dashpNum(c[id + 'RevenueQualified']), rate: dashpNum(c[id + 'CommissionPercent']),
    expected: dashpNum(c['expected' + label + 'Commission']), sold: dashpNum(dashpObj(k.salesByCategory)[id]), soldQualified: dashpNum(dashpObj(k.qualifiedByCategory)[id]) });
  return {
    name: dashpStr(dashpObj(r.rep).name) || 'Sales rep', office: dashpStr(dashpObj(dashpObj(r.rep).homeOffice).name),
    // The payout waterfall, as DASHP stored it. hasSteps = false on a result that predates it.
    hasSteps: steps.every(x => x != null), expected: dashpNum(steps[0]), afterAttrition: dashpNum(steps[1]), afterMultiYear: dashpNum(steps[2]), afterAudit: dashpNum(steps[3]), final: dashpNum(steps[4]),
    categories: [cat('pest', 'Pest'), cat('bundle', 'Bundle'), cat('ancillary', 'Ancillary')],
    revenue: dashpNum(c.totalRevenue), revenueQualified: dashpNum(c.totalRevenueQualified),
    sold: dashpNum(k.totalAccountsSold), cancels: dashpNum(k.totalCancels), withBalance: dashpNum(k.accountsWithBalance),
    notQualified: Object.entries(dashpObj(k.byDisqualificationReason)).map(([code, n]) => ({ label: dashpReason(code), n: dashpNum(n) })).filter(x => x.n > 0),
    audits: dashpNum(a.totalAudits), auditsFailed: dashpNum(a.failedAudits), auditPass: a.auditPassPercent == null ? null : dashpNum(a.auditPassPercent), auditDeduction: dashpNum(a.auditDeduction),
    multiYearPct: my.myPercent == null ? null : dashpNum(my.myPercent), multiYearTotal: dashpNum(my.myTotal), multiYearBonus: my.earnedMyBonus === true,
    sales: dashpArr(r.salesDetail).map(dashpSale),
  };
}