// ────────────────────────────────────────────────────────────────────────
// SERVER-SIDE INDICATORS DERIVE
//
// Verbatim port of the browser's snapshot → indicators transform
// (reportingSnapshotToIndicatorsCsv + parseIndicatorsCsv/parseRawSalesReport
// in index.html). The RevHawk sync job calls deriveIndicatorsPayload() after
// writing each snapshot, so the SHARED dataset (indicators/latest.json.gz)
// is produced by ONE writer — the server — instead of whichever admin's
// browser happened to be open. Browsers become readers.
//
// PARITY RULES (read before editing):
//  • The CSV round-trip is intentional. Going rows → CSV text → parse gives
//    byte-identical normalization (trims, parseNum, office uppercase, date
//    handling) to what every browser produced historically. Do not "optimize"
//    it away without re-running the parity test in tools/derive-parity-test.
//  • TZ is pinned to America/New_York below so week bucketing matches what
//    ET browsers computed. Change this only in lockstep with the client.
//  • ADDITIVE fields are allowed (repType/repId below); removing or renaming
//    existing fields is a breaking change for every open client.
// ────────────────────────────────────────────────────────────────────────
process.env.TZ = process.env.TZ || 'America/New_York';

// ── 1:1 port of reportingSnapshotToIndicatorsCsv ─────────────────────────
function snapshotToIndicatorsCsv(rows) {
  const fmtDate = (r) => {
    const raw = r.sold_at || r.sold_date || '';
    const m = String(raw).match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}:\d{2}(?::\d{2})?))?/);
    if (!m) return '';
    const date = m[2] + '/' + m[3] + '/' + m[1];     // MM/DD/YYYY (parser wants slashes)
    return m[4] ? (date + ' ' + m[4]) : date;         // append 24h time when present
  };
  const esc = (v) => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
  const headers = ['Office', 'Date Sold', 'Customer Id', 'Customer Name', 'Subscription', 'Active', 'Cancellation Reason', 'Cancellation Date', 'Age', 'Source', 'Contract', 'Contract Value', 'Initial Price', 'Annual Recurring Value', 'Completed Services', 'Status', 'Auto Pay', 'Sales Rep', 'Sales Rep Id', 'Sales Rep Type', 'Customer Flags', 'Serviced Date', 'Initial Status'];
  const lines = [headers.join(',')];
  for (const r of (rows || [])) {
    lines.push([
      r.office_name || '', fmtDate(r), r.customer_id || '', [r.last_name, r.first_name].filter(Boolean).join(', '),
      r.subscription || '', r.subscription_status || '', r.subscription_cancellation_reason || '', r.subscription_date_canceled || '',
      r.days_past_due || 0, r.subscription_source || '', r.agreement_length || 0, r.subscription_contract_value || 0, r.initial_price || 0,
      r.annual_recurring_value || 0, r.subscription_completed_services || 0, r.subscription_status || '', r.customer_auto_pay || '',
      r.sold_by || '', r.sold_by_id || '', r.sold_by_type || '', r.customer_flags || '', r.initial_serviced_date || '', r.initial_status || '',
    ].map(esc).join(','));
  }
  return lines.join('\n');
}

// ── 1:1 port of parseIndicatorsCsv / parseRawSalesReport ─────────────────
// Client-only housekeeping (rep alias learning, roster reactivation,
// rep-office merges) is intentionally absent: none of it shapes the payload,
// and the client now performs it when it APPLIES the payload instead.
function parseIndicators(text) {
  function parseCsvLine(line) {
    const result = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQuotes = !inQuotes; }
      else if (c === ',' && !inQuotes) { result.push(current.trim()); current = ''; }
      else { current += c; }
    }
    result.push(current.trim());
    return result;
  }

  const lines = text.replace(/^\uFEFF/, '').trim().split('\n').filter(l => l.trim());
  if (lines.length < 2) throw new Error('CSV has no data rows');
  const headerRow = parseCsvLine(lines[0]);
  const headers = headerRow.map(h => h.toLowerCase().trim());
  const findCol = (...names) => headers.findIndex(h => names.some(n => h.includes(n)));

  const iOffice    = findCol('office', 'branch');
  const iCustId    = headers.findIndex(h => h.includes('customer id') || h.includes('cust id') || h.includes('account id') || h.includes('account number') || h.includes('account #'));
  const iCustName  = headers.findIndex((h, idx) => idx !== iCustId && h.includes('customer'));
  const iCustomer  = iCustId >= 0 ? iCustId : iCustName;
  const iDateSold  = findCol('date sold');
  const iContract  = findCol('contract');
  const iInitPrice = findCol('initial service price', 'initial price');
  const iRecurring = findCol('recurring');
  const iServices  = findCol('services');
  const iContractVal = findCol('contract value');
  const iStatus    = findCol('status');
  const iAPay      = findCol('apay', 'auto pay');
  const iRep       = findCol('sales rep', 'rep');
  const iSub       = findCol('subscription');
  const iActive    = findCol('active');
  const iCancelR   = findCol('cancel reason', 'cancellation reason', 'cancelation reason', 'cxl reason');
  const iCancelD   = findCol('cancel date', 'cancellation date', 'cancelation date', 'cxl date', 'date cancelled', 'date canceled');
  const iAge       = findCol('age');
  const iSource    = findCol('source');
  const iCustFlags = findCol('customer flags', 'customer flag', 'flags');
  const iServicedDate = findCol('serviced date', 'date serviced', 'service date');
  const iInitialStatus = findCol('initial status');
  const iRepId = headers.findIndex(h => h.includes('rep id'));
  const iRepType = headers.findIndex(h => h.includes('rep type'));

  const isRawSales = iCustomer >= 0 && iDateSold >= 0 && iOffice >= 0;
  if (!isRawSales) throw new Error('snapshot CSV is not in raw-sales format — server derive aborted');

  const cols = {
    iOffice, iDateSold, iContract, iInitPrice, iContractVal, iStatus, iAPay, iRep, iRepId, iRepType, iRecurring, iServices,
    iSub, iActive, iCancelR, iCancelD, iAge, iSource, iCustName, iCustId, iCustFlags, iServicedDate, iInitialStatus,
  };

  const parseNum = (s) => parseFloat(String(s || '').replace(/[$,%]/g, '').replace(/,/g, '').trim()) || 0;

  const sales = [];
  for (let i = 1; i < lines.length; i++) {
    const c = parseCsvLine(lines[i]);
    const office = (c[cols.iOffice] || '').toUpperCase().trim();
    if (!office) continue;
    if (/^office\s*-\s*\d/i.test(office)) continue;   // phantom CRM offices — never real branches
    const dateSold = c[cols.iDateSold] || '';
    let dateObj = null;
    if (dateSold) {
      const parts = dateSold.split(' ')[0].split('/');
      if (parts.length === 3) {
        let [m, d, y] = parts.map(Number);
        if (y < 100) y += 2000;
        dateObj = new Date(y, m - 1, d);
      }
    }
    sales.push({
      office,
      date: dateObj,
      customer:   cols.iCustName >= 0 ? (c[cols.iCustName] || '').trim() : '',
      customerId: cols.iCustId   >= 0 ? (c[cols.iCustId]   || '').trim()
                  : (cols.iCustName >= 0 ? (c[cols.iCustName] || '').trim() : ''),
      subscription: cols.iSub >= 0 ? (c[cols.iSub] || '').trim() : '',
      active: cols.iActive >= 0 ? (c[cols.iActive] || '').trim() : '',
      cancelReason: cols.iCancelR >= 0 ? (c[cols.iCancelR] || '').trim() : '',
      cancelDate: cols.iCancelD >= 0 ? (c[cols.iCancelD] || '').trim() : '',
      age: cols.iAge >= 0 ? parseNum(c[cols.iAge]) : 0,
      source: cols.iSource >= 0 ? (c[cols.iSource] || '').trim() : '',
      contract: parseNum(c[cols.iContract]),
      initialPrice: parseNum(c[cols.iInitPrice]),
      contractValue: parseNum(c[cols.iContractVal]),
      recurring: parseNum(c[cols.iRecurring]),
      services: parseNum(c[cols.iServices]),
      status: (c[cols.iStatus] || '').trim(),
      autoPay: (c[cols.iAPay] || '').trim(),
      customerFlags: cols.iCustFlags >= 0 ? (c[cols.iCustFlags] || '').trim() : '',
      servicedDate: cols.iServicedDate >= 0 ? (c[cols.iServicedDate] || '').trim() : '',
      initialStatus: cols.iInitialStatus >= 0 ? (c[cols.iInitialStatus] || '').trim() : '',
      rep: (c[cols.iRep] || '').trim(),
      repId: cols.iRepId >= 0 ? (c[cols.iRepId] || '').trim() : '',
      repType: cols.iRepType >= 0 ? (c[cols.iRepType] || '').trim() : '',
      dateSold: dateSold,
    });
  }

  if (!sales.length) throw new Error('No valid sales rows found');

  // Find the earliest date → week 0 start (round to Sunday)
  const validDates = sales.filter(s => s.date).map(s => s.date.getTime());
  const minDate = new Date(Math.min(...validDates));
  const weekStart = new Date(minDate);
  weekStart.setDate(weekStart.getDate() - weekStart.getDay()); // Sunday start
  weekStart.setHours(0, 0, 0, 0);

  sales.forEach(s => {
    if (s.date) {
      s.week = Math.floor((s.date.getTime() - weekStart.getTime()) / (7 * 86400000));
    } else {
      s.week = 0;
    }
  });

  // Group by office + week and aggregate
  const groups = {};
  sales.forEach(s => {
    const key = s.office + '|' + s.week;
    if (!groups[key]) groups[key] = { office: s.office, week: s.week, sales: [] };
    groups[key].sales.push(s);
  });

  const rows = [];
  const isSentricon = (s) => /sentricon/i.test(s.subscription || '');
  for (const g of Object.values(groups)) {
    const ss = g.sales;
    const count = ss.length;
    const revenue = ss.reduce((a, s) => a + s.contractValue, 0);
    const pestSales = ss.filter(s => !isSentricon(s));
    const avgInit = pestSales.length > 0 ? pestSales.reduce((a, s) => a + s.initialPrice, 0) / pestSales.length : 0;
    const avgInitCount = pestSales.length;
    const multiYears = ss.filter(s => s.contract >= 18).length;
    const twelveMonth = ss.filter(s => s.contract === 12).length;
    const autoPayCount = ss.filter(s => s.autoPay && s.autoPay !== 'No').length;
    const auditFail = ss.filter(s => /failed\s*audit/i.test(s.customerFlags || '')).length;
    const lastResort = ss.filter(s => (Number(s.initialPrice) || 0) < 99).length;
    const uniqueReps = new Set(ss.map(s => s.rep).filter(Boolean)).size;

    const weekStartDate = new Date(weekStart.getTime() + g.week * 7 * 86400000);
    const weekEndDate = new Date(weekStartDate.getTime() + 6 * 86400000);
    const dateLabel = (weekStartDate.getMonth() + 1) + '/' + weekStartDate.getDate() + '-' +
                      (weekEndDate.getMonth() + 1) + '/' + weekEndDate.getDate();
    const isoStart = weekStartDate.toISOString().slice(0, 10);

    rows.push({
      week: g.week,
      date: dateLabel,
      iso_start: isoStart,
      branch: g.office,
      sold_accounts: count,
      revenue,
      avg_initial: avgInit,
      avg_initial_count: avgInitCount,
      auto_pay_pct: count > 0 ? autoPayCount / count : 0,
      audit_fail: auditFail,
      last_resort: lastResort,
      multi_years: multiYears,
      twelve_month: twelveMonth,
      reps: uniqueReps,
    });
  }

  if (!rows.length) throw new Error('No data after aggregation');

  // Same shape the client persists as _indicatorRawSales (minus _rawRow,
  // which the cloud payload never carried) — PLUS the additive repType/repId
  // fields the client parser drops. _indicatorDeptOf(s) reads s.repType
  // first, so server payloads give every rep the authoritative per-sale
  // department without needing the reporting sig-map.
  const rawSales = sales.map(s => ({
    customer: s.customer || '',
    customerId: s.customerId || s.customer || '',
    office: s.office,
    subscription: s.subscription || '',
    active: s.active || '',
    cancelReason: s.cancelReason || '',
    cancelDate: s.cancelDate || '',
    rep: s.rep,
    week: s.week,
    dateSold: s.dateSold || '',
    status: s.status,
    autoPay: s.autoPay,
    customerFlags: s.customerFlags || '',
    servicedDate: s.servicedDate || '',
    initialStatus: s.initialStatus || '',
    age: s.age || 0,
    source: s.source || '',
    contract: s.contract,
    initialPrice: s.initialPrice,
    contractValue: s.contractValue,
    recurring: s.recurring,
    services: s.services,
    repType: s.repType || '',
    repId: s.repId || '',
  }));

  return { indicatorsData: rows, rawSales };
}

// ── Public API ────────────────────────────────────────────────────────────
// rows: the snapshot row objects the sync job already built (post null-strip)
// uploadedAt: the reporting_uploads row's uploaded_at — ties the dataset's
//             freshness to the snapshot so clients' "already ≥ snapshot"
//             checks line up exactly.
function deriveIndicatorsPayload(rows, uploadedAt, fileName) {
  // 3-YEAR FENCE (#6) — the boards show the current year plus two prior
  // (YoY lines, records, trends). Anything older is dead weight every
  // phone would download, parse, hold in memory, and re-filter on every
  // render (~16% of all rows were 2020-2023). Undated rows are kept —
  // they can't be age-judged and the parser already handles them.
  // To widen history, change YEARS_KEPT and redeploy.
  const YEARS_KEPT = 3;
  const fence = (new Date().getFullYear() - (YEARS_KEPT - 1)) + '-01-01';
  rows = (rows || []).filter(r => {
    const d = String((r && (r.sold_at || r.sold_date)) || '').slice(0, 10);
    return !d || d >= fence;
  });
  const { indicatorsData, rawSales } = parseIndicators(snapshotToIndicatorsCsv(rows));
  return {
    uploadedAt: uploadedAt,
    fileName: fileName || ('RevHawk sync — ' + new Date(uploadedAt).toLocaleDateString('en-US')),
    derivedBy: 'server',                 // lets clients/logs distinguish the writer
    indicatorsData,
    rawSales,
  };
}

module.exports = { deriveIndicatorsPayload, snapshotToIndicatorsCsv, parseIndicators };
