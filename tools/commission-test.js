#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
// COMMISSION GOLDEN TESTS (P0-3 / P1-4 in AUDIT.md) — locks the D2D
// backend commission math in commissionCompute: category rates, the
// multi-year bonus / penalty bands, the canonical gates (global excluded
// services, excluded sources, renewals, sold-not-started), cancel-reason
// exclusions, 3-day RORs, after-lock cancels, and the net-due arithmetic.
// Every number below is worked by hand in the comments so a payroll
// reviewer can follow it. Extracted from app.js; drift fails the deploy.
// ════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
function extractFn(name) {
  const start = appJs.indexOf('function ' + name + '(');
  if (start === -1) throw new Error('cannot find function ' + name);
  let i = appJs.indexOf('{', start), depth = 0;
  for (; i < appJs.length; i++) { const ch = appJs[i]; if (ch === '{') depth++; else if (ch === '}') { depth--; if (depth === 0) return appJs.slice(start, i + 1); } }
  throw new Error('unbalanced braces extracting ' + name);
}
function extractConst(name) { const m = appJs.match(new RegExp('const ' + name + ' = [^\\n]*;')); if (!m) throw new Error('cannot find const ' + name); return m[0]; }
function extractGlobals() { const m = appJs.match(/const FR_GLOBAL_EXCLUDED_SERVICES = new Set\(\[([\s\S]*?)\]\);/); if (!m) throw new Error('no FR_GLOBAL_EXCLUDED_SERVICES'); return 'const FR_GLOBAL_EXCLUDED_SERVICES = new Set([' + m[1] + ']);'; }

// The engine's collaborators, pinned to their production defaults.
const src = [
  extractGlobals(),
  extractConst('COMMISSION_MY_DEFAULT'),
  extractConst('COMMISSION_RATE_DEFAULT'),
  extractFn('commissionConfig'),
  extractFn('commissionRulesForType'),
  extractFn('commissionRatesFor'),
  extractFn('commissionManual'),
  extractFn('commissionCompute'),
  'return { commissionCompute };',
].join('\n');
const state = {
  commissionConfig: {
    serviceCategories: { 'Pest 4': 'pest', 'RIDD Package 6': 'bundle', 'Pest Mosquito 6': 'ancillary', 'Termite Inspection': 'exclude' },
    manual: { 'E1': { overrides: 100, rent: 50, paidYtd: 200, other: 0, audit: 25, payPeriods: 10 } },
  },
  reportingSubscriptions: [],
};
const stubs = {
  reportingExcludedSources: () => new Set(['Bad Source']),
  reportingSourceClass: (s) => /^renewal/i.test(String(s || '')) ? 'renewal' : 'new',
  reportingExcludedCancelReasons: () => new Set(['combined subscriptions']),
  _normCancelReason: (s) => String(s || '').trim().toLowerCase(),
  reportingCancelReasonOf: (r) => r.subscription_cancellation_reason || '',
  reportingAgingDays: () => 7,
};
const fn = new Function('state', ...Object.keys(stubs), src);
const { commissionCompute } = fn(state, ...Object.values(stubs));

const D = (s) => Date.parse(s + 'T00:00:00Z');
const sub = (o) => Object.assign({ sold_by_id: 'E1', sold_date: '2026-06-10', subscription: 'Pest 4', subscription_source: 'Door to Door', subscription_contract_value: 1000, agreement_length: 12, initial_status: 'Completed', days_past_due: 0, subscription_cancellation_reason: '', subscription_date_canceled: null, subscription_id: 1, customer_id: 9 }, o);
state.reportingSubscriptions = [
  sub({ subscription_id: 1 }),                                                         // pest 1000, 12mo
  sub({ subscription_id: 2, subscription: 'RIDD Package 6', subscription_contract_value: 2000, agreement_length: 24 }), // bundle 2000, 24mo
  sub({ subscription_id: 3, subscription: 'Pest Mosquito 6', subscription_contract_value: 500, agreement_length: 18 }), // ancillary 500, 18mo
  sub({ subscription_id: 4, subscription: 'Termite Inspection', subscription_contract_value: 300 }),                    // category exclude → exclRev
  sub({ subscription_id: 5, subscription: 'Unknown Thing', subscription_contract_value: 400 }),                         // unclassified → unclRev
  sub({ subscription_id: 6, subscription: 'ACH Chargeback', subscription_contract_value: 50 }),                          // global gate
  sub({ subscription_id: 7, subscription_source: 'Bad Source' }),                                                        // source gate
  sub({ subscription_id: 8, subscription_source: 'Renewal - Loyalty' }),                                                 // renewal gate
  sub({ subscription_id: 9, initial_status: 'Cancelled' }),                                                              // sold-not-started gate
  sub({ subscription_id: 10, sold_date: '2026-01-05' }),                                                                 // outside window
  sub({ subscription_id: 11, sold_by_id: 'E2' }),                                                                        // someone else
  sub({ subscription_id: 12, subscription_date_canceled: '2026-06-11', subscription_cancellation_reason: 'Finances' }),  // 3-day ROR (day 1)
  sub({ subscription_id: 13, subscription_date_canceled: '2026-07-20', subscription_cancellation_reason: 'Moved' }),     // real cancel, before lock
  sub({ subscription_id: 14, subscription_date_canceled: '2026-09-01', subscription_cancellation_reason: 'Moved' }),     // cancel AFTER lock
  sub({ subscription_id: 15, subscription_date_canceled: '2026-07-01', subscription_cancellation_reason: 'Combined Subscriptions' }), // excluded reason
  sub({ subscription_id: 16, days_past_due: 30 }),                                                                       // with balance
];
const R = commissionCompute({ employee_id: 'E1', type_label: 'Sales Rep' }, D('2026-06-01'), D('2026-06-30'), D('2026-08-15'));

let fail = 0;
const eq = (label, got, want, eps = 1e-9) => { const ok = typeof want === 'number' ? Math.abs(got - want) <= eps : got === want; if (!ok) { fail++; console.error('  ✗ ' + label + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } else console.log('  ✓ ' + label + ' = ' + JSON.stringify(got)); };

// Rows that survive the gates: 1,2,3,4,5,12,13,14,15,16 = 10
eq('rawMatched (E1 in window)', R.rawMatched, 14);
eq('gates: global / source / renewal / sns', [R.gates.global.n, R.gates.source.n, R.gates.renewal.n, R.gates.sns.n].join('/'), '1/1/1/1');
eq('sold (commissionable rows)', R.sold, 10);
// Revenue by category: pest = 1000 (1) + 1000×5 (12,13,14,15,16) = 6000; bundle 2000; ancillary 500
eq('pestRev', R.pestRev, 6000);
eq('bundleRev', R.bundleRev, 2000);
eq('ancRev', R.ancRev, 500);
eq('exclRev (category exclude)', R.exclRev, 300);
eq('unclRev (unclassified)', R.unclRev, 400);
eq('payableRev', R.payableRev, 8500);
// Rates: pest 20%, bundle 20%×0.8 = 16%, ancillary 20%×0.5 = 10%
eq('pestComm 6000×20%', R.pestComm, 1200);
eq('bundleComm 2000×16%', R.bundleComm, 320);
eq('ancComm 500×10%', R.ancComm, 50);
// Multi-year: 24mo → 2000, 18mo → 500; myPct = 2500/8500 = 29.41% < 55 → penalty 5% of payable = −425
eq('myPct', R.myPct, 2500 / 8500 * 100);
eq('multiYearAmt (penalty band)', R.multiYearAmt, -425);
// totals: 1200+320+50 + overrides 100 − 425 = 1245 ; net = 1245 − 50 − 200 − 0 − 25 = 970 ; ÷10 = 97
eq('totalCommission', R.totalCommission, 1245);
eq('netDue', R.netDue, 970);
eq('biWeekly', R.biWeekly, 97);
// Attrition: cancels 12,13,14 count (15 excluded reason) → 3; ROR 1 (12); after lock 1 (14); final = 3−1−1 = 1 of 10 = 10%
eq('canceled (excl. reason removed)', R.canceled, 3);
eq('reasonExcl', R.reasonExcl, 1);
eq('ror', R.ror, 1);
eq('afterLock', R.afterLock, 1);
eq('finalAttrition %', R.finalAttrition, 10);
eq('withBalance (≥7 dpd, not cancelled)', R.withBalance, 1);
// Inputs block: auditable and complete
eq('inputs.sales length', (R.inputs && R.inputs.sales || []).length, 10);
eq('inputs.rates.pest', R.inputs.rates.pest, 0.2);
eq('inputs.manual.payPeriods', R.inputs.manual.payPeriods, 10);
eq('inputs.window', R.inputs.window.start + '→' + R.inputs.window.end + '@' + R.inputs.window.lock, '2026-06-01→2026-06-30@2026-08-15');
// Bonus band: push MY% above 75 with a per-rep override-free check
state.reportingSubscriptions = [sub({ subscription_id: 1, agreement_length: 24, subscription_contract_value: 8000 }), sub({ subscription_id: 2, agreement_length: 12, subscription_contract_value: 2000 })];
state.commissionConfig.manual = {};
const R2 = commissionCompute({ employee_id: 'E1', type_label: 'Sales Rep' }, D('2026-06-01'), D('2026-06-30'), null);
eq('bonus band myPct 80%', R2.myPct, 80);
eq('multiYearAmt = 8000×3%', R2.multiYearAmt, 240);
eq('totalCommission 10000×20% + 240', R2.totalCommission, 2240);
eq('biWeekly default ÷26', R2.biWeekly, 2240 / 26);
if (fail) { console.error('commission golden tests: ' + fail + ' failure(s)'); process.exit(1); }
console.log('commission golden tests: all scenarios pass');
