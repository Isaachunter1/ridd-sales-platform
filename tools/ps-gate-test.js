#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// P/S GATE GOLDEN TESTS — locks in the hard-won Pending/Serviced rules.
//
// July 2026 taught us the hard way: frPendingServiced is THE canonical
// basis for every board (Indicators, leaderboard, all comps, pay), and it
// drifted repeatedly while reconciling against the CRM. These scenarios
// encode the FINAL agreed semantics, verified to the dollar against the
// CRM's own Pending/Serviced report:
//
//   1. SERVICE HAPPENED → counts. Always. (Completed services, or a
//      serviced date — post-service cancels and post-service 3-day RORs
//      included.)
//   2. NO SERVICE YET + SUB DEAD → never counts (any cancel reason:
//      ROR, finances, SNS, rep error — the CRM files these under
//      Canceled / Not Serviced).
//   3. NO SERVICE YET + SUB ALIVE → counts ONLY once the initial appt is
//      scheduled (status Pending). "No Appointment" = Subscription Added,
//      not P/S. Cancelled initial = out.
//   4. Global billing artifacts (ACH Chargeback, Early Cancellation Fee,
//      German Roach Initial) never count.
//   5. Manual mode: the sheet's CRM Status column is the whole gate —
//      Pending/Serviced in, Canceled/Not Serviced out, blank counts.
//
// The function is EXTRACTED FROM app.js — if an edit changes its behavior,
// this suite fails and ci-check blocks the deploy.
// ═══════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');

const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

// ── Extract a top-level function's source by name ──
function extractFn(name) {
  const start = appJs.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('cannot find function ' + name + ' in app.js');
  let i = appJs.indexOf('{', start), depth = 0;
  for (; i < appJs.length; i++) {
    const ch = appJs[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); }
  }
  throw new Error('unbalanced braces extracting ' + name);
}
// ── Extract the FR_GLOBAL_EXCLUDED_SERVICES set literal ──
function extractGlobals() {
  const m = appJs.match(/const FR_GLOBAL_EXCLUDED_SERVICES = new Set\(\[([\s\S]*?)\]\);/);
  if (!m) throw new Error('cannot find FR_GLOBAL_EXCLUDED_SERVICES');
  return 'const FR_GLOBAL_EXCLUDED_SERVICES = new Set([' + m[1] + ']);';
}

// Build a sandbox: the real gate + real SNS detector, with the state-
// dependent helpers stubbed to their normal production shape (Initial
// Status column present; legacy heuristic unused).
const state = { _indManualMode: false };
// ── Extract a top-level const declaration (regex literals etc.) ──
function extractConst(name) {
  const m = appJs.match(new RegExp('const ' + name + ' = [^\n]*;'));
  if (!m) throw new Error('cannot find const ' + name);
  return m[0];
}

const src = [
  extractGlobals(),
  extractConst('_SNS_REASON_RE'),
  extractFn('_isSoldNotStarted'),
  extractFn('frPendingServiced'),
  'return { frPendingServiced, setManual: (v) => { state._indManualMode = v; } };',
].join('\n');
let api;
try {
  // eslint-disable-next-line no-new-func
  api = new Function('state', '_scInitialStatusHasData', '_scIsSoldNotStarted', src)(
    state, () => true, () => false);
} catch (e) {
  console.error('ps-gate-test: could not assemble the gate from app.js — ' + e.message);
  process.exit(1);
}

// ── Scenario table ──
// Fields mirror the mirror rows: subscription, services (completed count),
// servicedDate, active (Yes/No/blank), cancelReason, initialStatus, status
// (manual-mode CRM Status).
const S = (over) => ({ subscription: 'Pest 4', services: 0, servicedDate: '', active: 'Yes', cancelReason: '', initialStatus: 'Pending', ...over });
const CASES = [
  // ── 1. Service happened → always counts ──
  ['serviced account', S({ services: 3, initialStatus: 'Completed' }), true],
  ['serviced then cancelled (post-service cancel counts)', S({ services: 2, active: 'No', cancelReason: 'Finances' }), true],
  ['post-service 3-day ROR counts', S({ services: 1, active: 'No', cancelReason: '3 Day ROR' }), true],
  ['serviced date alone is enough', S({ servicedDate: '2026-07-01', active: 'No', initialStatus: 'Cancelled' }), true],
  ['stale SNS reason on serviced account still counts', S({ services: 6, cancelReason: 'Sold, Not Started (No Initial)' }), true],
  // ── 2. No service + sub dead → never counts ──
  ['unserviced + cancelled (ROR) is out', S({ active: 'No', cancelReason: '3 Day ROR' }), false],
  ['unserviced + cancelled (finances) is out', S({ active: 'No', cancelReason: 'Finances' }), false],
  ['unserviced + cancelled (no reason) is out', S({ active: 'No' }), false],
  ['classic sold-not-started is out', S({ active: 'No', cancelReason: 'Sold, Not Started (No Initial)' }), false],
  ['SNS reason with blank active is out', S({ active: '', cancelReason: 'Sold, Not Started (No Initial)' }), false],
  // ── 3. No service + alive → scheduled initial required ──
  ['live pending with scheduled initial counts', S({}), true],
  ['no appointment yet = Subscription Added, not P/S', S({ initialStatus: 'No Appointment' }), false],
  ['cancelled initial appt (alive, unserviced) is out', S({ initialStatus: 'Cancelled' }), false],
  ['no-show initial is out', S({ initialStatus: 'No Show' }), false],
  // ── 4. Global billing artifacts never count ──
  ['ACH Chargeback excluded', S({ subscription: 'ACH Chargeback', services: 4 }), false],
  ['Early Cancellation Fee excluded', S({ subscription: 'Early Cancellation Fee' }), false],
  ['German Roach Initial excluded', S({ subscription: 'German Roach Initial', services: 1 }), false],
  // ── Sanity: SNS reason but sub ACTIVE again (cancel+rebook) counts ──
  ['re-activated sub with stale SNS reason counts', S({ cancelReason: 'Sold, Not Started (No Initial)', active: 'Yes' }), true],
];
const MANUAL_CASES = [
  ['manual: Status Serviced counts', S({ status: 'Serviced', active: 'No', initialStatus: 'Cancelled' }), true],
  ['manual: Status Pending counts', S({ status: 'Pending', initialStatus: 'No Appointment' }), true],
  ['manual: Status Canceled is out', S({ status: 'Canceled', services: 3 }), false],
  ['manual: Status Not Serviced is out', S({ status: 'Not Serviced' }), false],
  ['manual: blank Status counts (benefit of the doubt)', S({ status: '' }), true],
  ['manual: global exclusion still applies', S({ status: 'Serviced', subscription: 'ACH Chargeback' }), false],
];

let pass = 0, fail = 0;
const run = (name, row, want) => {
  const got = !!api.frPendingServiced(row);
  if (got === want) { pass++; }
  else { fail++; console.error('  ✗ ' + name + ' — expected ' + want + ', got ' + got); }
};
api.setManual(false);
for (const [n, r, w] of CASES) run(n, r, w);
api.setManual(true);
for (const [n, r, w] of MANUAL_CASES) run(n, r, w);
api.setManual(false);

if (fail) {
  console.error('ps-gate-test: ' + fail + ' FAILURE(S), ' + pass + ' passed — the Pending/Serviced basis CHANGED. If intentional, update the scenario table in tools/ps-gate-test.js with the new agreed rule.');
  process.exit(1);
}
console.log('ps-gate-test: all ' + pass + ' scenarios pass — P/S basis intact');
