#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────────────
// DERIVE PARITY TEST
// Proves the server-side indicators derive (netlify/functions/lib/
// indicators-derive.js) produces EXACTLY what the browser's parse path
// produces for the same snapshot rows. Run after touching either side:
//
//   node tools/derive-parity-test.js
//
// It extracts the client functions straight out of index.html (no manual
// copying — what ships is what's tested), shims the browser-only globals,
// runs both pipelines on synthetic rows covering the tricky cases, and
// deep-compares indicatorsData + rawSales (ignoring the server's additive
// repType/repId fields and the client-only _rawRow).
// ────────────────────────────────────────────────────────────────────────
process.env.TZ = 'America/New_York'; // match the server module's pin

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// ── extract a top-level function from index.html by brace counting ──
function extractFn(name) {
  const lines = html.split('\n');
  const startIdx = lines.findIndex(l => l.startsWith('function ' + name + '('));
  if (startIdx < 0) throw new Error('client function not found: ' + name);
  let depth = 0;
  const body = [];
  for (let j = startIdx; j < lines.length; j++) {
    body.push(lines[j]);
    depth += (lines[j].match(/{/g) || []).length - (lines[j].match(/}/g) || []).length;
    if (depth === 0 && j > startIdx) return body.join('\n');
  }
  throw new Error('unbalanced braces extracting ' + name);
}

// ── client sandbox with browser-only globals shimmed ──
const sandbox = {
  console,
  state: {},
  _autoAliasByRepId: () => {},           // config housekeeping — no payload effect
  reactivateRecentSellers: () => {},
  _invalidateRepSigIndex: () => {},
  saveIndicatorState: () => {},
  getCanonicalRepName: (n) => n,
  _cleanRepName: (n) => String(n || '').trim(),
};
vm.createContext(sandbox);
for (const fn of ['parseIndicatorsCsv', 'parseRawSalesReport', 'parsePreAggregated', 'reportingSnapshotToIndicatorsCsv']) {
  vm.runInContext(extractFn(fn), sandbox);
}
// parsePreAggregated references parsePct in some formats; shim if absent.
if (!/function parsePct/.test(extractFn('parsePreAggregated'))) {
  vm.runInContext('function parsePct(s){return parseFloat(String(s||"").replace(/%/g,""))/100||0;}', sandbox);
}

const server = require(path.join(root, 'netlify/lib/indicators-derive.js'));

// ── synthetic snapshot rows — every normalization edge we rely on ──
const rows = [
  // plain sale, multi-year, autopay CC
  { office_name: 'atlanta', sold_date: '2026-03-02', customer_id: '101', last_name: 'Smith', first_name: 'Ann',
    subscription: 'Pest 4', subscription_status: 'Active', agreement_length: '24', subscription_contract_value: '1200.50',
    initial_price: '99', annual_recurring_value: '480', subscription_completed_services: '2', customer_auto_pay: 'CC',
    sold_by: 'Sauer, Drew', sold_by_id: '77', sold_by_type: 'Sales Rep', customer_flags: '', subscription_source: 'Door to Door' },
  // quoted comma name + sentricon (excluded from avg pest) + 12-month
  { office_name: 'ATLANTA', sold_date: '2026-03-04 14:23', customer_id: '102', last_name: 'O"Brien, Jr', first_name: 'Bo',
    subscription: 'Sentricon South Carolina - Retreat', subscription_status: 'Active', agreement_length: '12',
    subscription_contract_value: '2000', initial_price: '1500', customer_auto_pay: 'No',
    sold_by: 'Drew Sauer', sold_by_id: '77', sold_by_type: 'Sales Rep', customer_flags: 'FAILED AUDIT' },
  // phantom office — must be dropped entirely
  { office_name: 'Office -1', sold_date: '2026-03-05', customer_id: '103', last_name: 'Ghost', first_name: 'Row',
    subscription: 'Pest 6', subscription_status: 'Active', subscription_contract_value: '500', initial_price: '50',
    sold_by: 'Nobody', sold_by_type: 'Sales Rep' },
  // missing date → week 0
  { office_name: 'destin', customer_id: '104', last_name: 'Nodate', first_name: 'Nia',
    subscription: 'Pest 4', subscription_status: 'Frozen', subscription_contract_value: '800', initial_price: '120',
    sold_by: 'Karson Murray', sold_by_id: '88', sold_by_type: 'Office Staff', subscription_cancellation_reason: 'Service, Too expensive' },
  // DST-side Sunday (the week-bucket edge) + canceled
  { office_name: 'destin', sold_date: '2026-07-05', customer_id: '105', last_name: 'Sunday', first_name: 'Sal',
    subscription: 'Pest 6', subscription_status: 'Cancelled', subscription_date_canceled: '2026-07-20',
    agreement_length: '18', subscription_contract_value: '999.99', initial_price: '0', customer_auto_pay: 'ACH',
    sold_by: 'Murray, Karson', sold_by_id: '88', sold_by_type: 'Office Staff', customer_flags: 'VIP' },
  // 2-digit year date form via sold_at, currency symbols in numbers
  { office_name: 'raleigh', sold_at: '2026-01-04T09:15:00', customer_id: '106', last_name: 'Early', first_name: 'Eve',
    subscription: 'RIDD Package 4', subscription_status: 'Active', agreement_length: '36',
    subscription_contract_value: '1,450.75', initial_price: '$149', customer_auto_pay: '',
    sold_by: 'Beaird, Ethan', sold_by_id: '99', sold_by_type: 'Sales Rep' },
];

// simulate the sync job's null/empty strip
const stripped = rows.map(o => {
  const c = { ...o };
  for (const k of Object.keys(c)) if (c[k] === null || c[k] === undefined || c[k] === '') delete c[k];
  return c;
});

// ── run both pipelines ──
const csvClient = vm.runInContext('reportingSnapshotToIndicatorsCsv(globalThis.__rows)', Object.assign(sandbox, { __rows: stripped }) === sandbox ? (sandbox.__rows = stripped, sandbox) : sandbox);
const csvServer = server.snapshotToIndicatorsCsv(stripped);

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) { console.log('  ✓ ' + label); }
  else { failures++; console.error('  ✗ ' + label + (detail ? '\n    ' + detail : '')); }
};

console.log('CSV stage:');
check('CSV text identical', csvClient === csvServer,
  csvClient !== csvServer ? 'first diff at char ' + [...csvServer].findIndex((c, i) => c !== csvClient[i]) : '');

console.log('Parse stage:');
sandbox.__csv = csvClient;
const clientData = vm.runInContext('parseIndicatorsCsv(globalThis.__csv)', sandbox);
const clientRaw = sandbox.state._indicatorRawSales.map(s => { const { _rawRow, ...rest } = s; return rest; });
const serverOut = server.parseIndicators(csvServer);
const serverRaw = serverOut.rawSales.map(s => { const { repType, repId, ...rest } = s; return rest; });

const sortKey = (r) => r.branch + '|' + r.week;
const normAgg = (arr) => JSON.stringify([...arr].sort((a, b) => sortKey(a).localeCompare(sortKey(b))));
check('indicatorsData deep-equal (' + clientData.length + ' agg rows)', normAgg(clientData) === normAgg(serverOut.indicatorsData));
check('rawSales deep-equal (' + clientRaw.length + ' sales)', JSON.stringify(clientRaw) === JSON.stringify(serverRaw),
  JSON.stringify(clientRaw) !== JSON.stringify(serverRaw)
    ? 'client[0]=' + JSON.stringify(clientRaw[0]) + '\n    server[0]=' + JSON.stringify(serverRaw[0]) : '');

console.log('Behavior checks:');
check('phantom office dropped', !serverRaw.some(s => /^office\s*-/i.test(s.office)));
check('additive repType present on server rawSales', serverOut.rawSales.every(s => 'repType' in s));
check('sentricon excluded from avg pest (ATLANTA agg)', (() => {
  const atl = serverOut.indicatorsData.filter(r => r.branch === 'ATLANTA');
  return atl.every(r => r.avg_initial_count <= r.sold_accounts) &&
         atl.some(r => r.avg_initial_count < r.sold_accounts); // the sentricon row reduced the denominator
})());
// The historical parser keeps commas INSIDE quoted fields but drops the
// quote characters themselves ("" → nothing). Parity means the server does
// the same — assert the comma survived, not the quote.
check('quoted comma name survives round-trip', serverRaw.some(s => (s.customer || '').includes('Brien, Jr')));
check('missing date lands in week 0', serverRaw.filter(s => !s.dateSold).every(s => s.week === 0));

if (failures) { console.error('\nPARITY: FAIL (' + failures + ')'); process.exit(1); }
console.log('\nPARITY: PASS — server derive is byte-equivalent to the client parse');
