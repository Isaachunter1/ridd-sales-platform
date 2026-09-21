#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
// ATTRITION GOLDEN TESTS — locks the ONE revenue-attrition definition the
// rep leaderboard's "Attrition %" column and the player card's headline
// number share (P1-10 / P1-4 in AUDIT.md):
//
//   attrition = cancelled $ ÷ serviced $, contract value, with
//   3-day RORs and one-time services removed from BOTH sides, and a
//   "saved" account (status Active despite a logged cancel) counted as kept.
//
// Functions are EXTRACTED FROM app.js — if an edit changes their behaviour,
// this suite fails and ci-check blocks the deploy.
// ════════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const appJs = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');

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
function extractConst(name) {
  const m = appJs.match(new RegExp('const ' + name + ' = [^\\n]*;'));
  if (!m) throw new Error('cannot find const ' + name);
  return m[0];
}
const src = [
  extractConst('_ROR_REASON_RE'),
  extractConst('_SNS_REASON_RE'),
  extractFn('_parseSlashDate'),
  extractFn('_isSoldNotStarted'),
  extractFn('_is3DayROR'),
  extractFn('_subAliveNow'),
  extractFn('_attrRevIsSvc'),
  extractFn('_attrRevIsAct'),
  extractFn('_attrRevIsOTS'),
  extractFn('_attrRevParts'),
  extractFn('_isRorReason'),
  extractFn('_landingAttritionPct'),
  'return { _attrRevParts, _is3DayROR, _isRorReason, _landingAttritionPct };',
].join('\n');
const state = { _indManualMode: false };
const { _attrRevParts, _is3DayROR, _isRorReason, _landingAttritionPct } = new Function('state', src)(state);

// ── Fixtures: one sale each, the way indicatorSales() rows look ──
const base = { subscription: 'Pest 4', contract: '12', contractValue: 1000, services: 2, status: 'Active', dateSold: '5/1/2026', cancelDate: '', cancelReason: '', active: 'Yes' };
const S = (o) => ({ ...base, ...o });
const cases = [
  ['active serviced account: serviced $, no cancel',            S({}),                                                                { serv: 1000, cxl: 0 }],
  ['serviced then cancelled (real reason): both sides',        S({ status: 'Inactive', active: 'No', cancelDate: '8/1/2026', cancelReason: 'Moved' }), { serv: 1000, cxl: 1000 }],
  ['never serviced: counts nowhere',                            S({ services: 0, servicedDate: '' }),                                  { serv: 0, cxl: 0 }],
  ['3-day ROR by reason: removed from both sides',              S({ status: 'Inactive', active: 'No', cancelDate: '5/2/2026', cancelReason: '3 Day ROR' }), { serv: 0, cxl: 0 }],
  ['3-day ROR by timing (mistagged reason): removed',           S({ status: 'Inactive', active: 'No', cancelDate: '5/3/2026', cancelReason: 'Finances' }), { serv: 0, cxl: 0 }],
  ['cancel on day 4: NOT an ROR, counts as churn',              S({ status: 'Inactive', active: 'No', cancelDate: '5/5/2026', cancelReason: 'Finances' }), { serv: 1000, cxl: 1000 }],
  ['"Subscription Error" reason is NOT an ROR (no /ror/ substring bug)', S({ status: 'Inactive', active: 'No', cancelDate: '8/1/2026', cancelReason: 'Subscription Error' }), { serv: 1000, cxl: 1000 }],
  ['one-time service by name: removed from both sides',        S({ subscription: 'One Time Pest Control', contract: '' }),             { serv: 0, cxl: 0 }],
  ['no contract months (one-time): removed',                    S({ contract: '0' }),                                                  { serv: 0, cxl: 0 }],
  ['Sentricon with blank contract: KEPT (annual program)',      S({ subscription: 'Sentricon South', contract: '' }),                   { serv: 1000, cxl: 0 }],
  ['saved account (Active + cancel date): kept, no churn',      S({ status: 'Active', active: 'Yes', cancelDate: '8/1/2026', cancelReason: 'Moved' }), { serv: 1000, cxl: 0 }],
  ['blank status + active No + cancel date: churn',             S({ status: '', active: 'No', cancelDate: '8/1/2026', cancelReason: 'Moved' }), { serv: 1000, cxl: 1000 }],
];
let fail = 0;
for (const [label, row, want] of cases) {
  const got = _attrRevParts(row);
  const ok = got.serv === want.serv && got.cxl === want.cxl;
  if (!ok) { fail++; console.error('  ✗ ' + label + '  got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); }
  else console.log('  ✓ ' + label);
}
// Aggregate: the number a manager reads
const book = cases.map(c => c[1]);
const t = book.reduce((a, r) => { const p = _attrRevParts(r); a.serv += p.serv; a.cxl += p.cxl; return a; }, { serv: 0, cxl: 0 });
const pct = t.serv ? t.cxl / t.serv : 0;
const wantPct = 4 / 7;   // 4 churned of 7 serviced $1,000 rows in the fixture
if (Math.abs(pct - wantPct) > 1e-9) { fail++; console.error('  ✗ fixture attrition % ' + pct + ' want ' + wantPct); }
else console.log('  ✓ fixture book attrition = ' + (pct * 100).toFixed(1) + '% (' + t.cxl + ' / ' + t.serv + ')');
// The Indicators landing "Attrition" tile must read the same book number.
const tilePct = _landingAttritionPct(book);
if (Math.abs(tilePct - wantPct) > 1e-9) { fail++; console.error('  ✗ landing tile attrition ' + tilePct + ' want ' + wantPct); }
else console.log('  ✓ landing tile attrition matches the leaderboard definition');
// Retention tab's reason test (same word-boundary rule, different surface)
for (const [reason, want] of [['3 Day ROR', true], ['ror', true], ['Right of Rescission', true], ['Subscription Error', false], ['Error - Duplicate', false], ['Moved', false]]) {
  const got = _isRorReason(reason.toLowerCase());
  if (got !== want) { fail++; console.error('  ✗ _isRorReason(' + JSON.stringify(reason) + ') = ' + got + ' want ' + want); }
  else console.log('  ✓ _isRorReason(' + JSON.stringify(reason) + ') = ' + got);
}
if (fail) { console.error('attrition golden tests: ' + fail + ' failure(s)'); process.exit(1); }
console.log('attrition golden tests: ' + cases.length + ' scenarios pass');
