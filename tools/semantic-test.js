#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════════
// SEMANTIC LAYER FIXTURES — locks the metric definitions in
// src/69-semantic.js. Every expected number is worked by hand in the
// comments. A change to a definition has to change this file too, on
// purpose; drift fails the deploy.
// ═══════════════════════════════════════════════════════════════════════
'use strict';
const fs = require('fs');
const path = require('path');
const src = fs.readFileSync(path.join(__dirname, '..', 'src', '69-semantic.js'), 'utf8');
const stubs = {
  state: { _retenWhatIf: null },
  reportingServiceRecurringMap: () => new Map([['Pest 4', true], ['One Time Pest Control', false]]),
  reportingExcludedCancelReasons: () => new Set(['combined subscriptions']),
  reportingExcludedSources: () => new Set(),
  reportingExcludeRorChurn: () => true,
  crmRorWindowDays: () => 3,
  retenExclRenewalSubs: () => false, retenExclZeroPay: () => false, retenExclOneSvc: () => false, retenExclFrozenOneSvc: () => false,
  retenPopExclReasons: () => new Set(), retenOneSvcExemptTerms: () => [],
  retenPopulationExcluded: (r) => r._out ? 'test' : '',
  reportingCancelReasonOf: (r) => r.subscription_cancellation_reason || '',
  _normCancelReason: (s) => String(s || '').trim().toLowerCase(),
  _reporting3dayRor: (r) => !!r._ror,
  reportingSourceClass: (s) => /^renewal/i.test(String(s || '')) ? 'renewal' : 'new',
  el: () => null,
};
const S = new Function(...Object.keys(stubs), src + '\nreturn { semRetentionBook, semCustomerLives, semMetric, semReachedContractEnd, SEM_METRICS, SEM_RULES, SEM_MO_MS };')(...Object.values(stubs));
let fail = 0;
const eq = (label, got, want, eps = 1e-9) => { const ok = typeof want === 'number' && typeof got === 'number' ? Math.abs(got - want) <= eps : got === want; if (!ok) { fail++; console.error('  ✗ ' + label + ': got ' + JSON.stringify(got) + ' want ' + JSON.stringify(want)); } };
const sub = (o) => Object.assign({ customer_id: 'c1', subscription: 'Pest 4', subscription_status: 'Active', initial_service: '2023-01-10', sold_date: '2023-01-05', annual_recurring_value: 600, agreement_length: 12, subscription_source: 'Facebook' }, o);

// ── The retention book: 8 raw rows → 5 in the book, 2 counted cancels ──
const raw = [
  sub({ id: 1 }),                                                                                                   // active
  sub({ id: 2, subscription_date_canceled: '2024-03-10', subscription_cancellation_reason: 'Moved', annual_recurring_value: 400 }),   // counted cancel, lived 14 mo
  sub({ id: 3, subscription_date_canceled: '2024-05-01', subscription_cancellation_reason: 'Combined Subscriptions' }),               // excluded reason → not churn
  sub({ id: 4, subscription_date_canceled: '2023-01-12', subscription_cancellation_reason: 'Changed mind', _ror: true }),             // 3-day ROR → not churn
  sub({ id: 5, initial_service: '2023-06-10', subscription_date_canceled: '2023-12-10', subscription_cancellation_reason: 'Delinquent' }), // counted cancel, lived 6 mo
  sub({ id: 6, subscription: 'One Time Pest Control' }),                                                             // not recurring → out
  sub({ id: 7, initial_service: null }),                                                                             // never serviced → out
  sub({ id: 8, _out: true }),                                                                                        // population rule → out
];
const book = S.semRetentionBook(raw);
eq('book size', book.length, 5);
eq('counted cancels', book.filter(r => r._effCancel).length, 2);
const M = S.semMetric;
// attrition 2 of 5 = 40%; retention 3 of 5 = 60%
eq('attrition_rate', M('attrition_rate')(book).value, 0.4);
eq('retention_rate', M('retention_rate')(book).value, 0.6);
// ARR: cancelled 400 + 600 = 1000 of 600×4 + 400 = 2800
eq('arr_attrition_rate', M('arr_attrition_rate')(book).value, 1000 / 2800);
// 2024: book on Jan 1 = rows 1,2,3,4 (row 5 cancelled in 2023) → 4; counted cancels in 2024 = row 2 → 25%
const a24 = M('annual_attrition')(book, 2024);
eq('annual_attrition 2024 book', a24.d, 4); eq('annual_attrition 2024 cancels', a24.n, 1); eq('annual_attrition 2024', a24.value, 0.25);
// 2023: nothing was first serviced before Jan 1 2023 → no book, no rate
eq('annual_attrition 2023 (no book)', M('annual_attrition')(book, 2023).value, null);
// Trailing 12 months as of 2024-06-30: book a year ago (2023-06-30) = rows 1,2,3,4,5 → 5; counted cancels since = rows 5 (Dec 2023) and 2 (Mar 2024) → 40%
const t12 = M('trailing12_attrition')(book, new Date('2024-06-30T12:00:00Z'));
eq('trailing12 book', t12.d, 5); eq('trailing12 cancels', t12.n, 2); eq('trailing12', t12.value, 0.4);
// Survival at 12 months, judged on 2025-01-10: all 5 are 12+ months old; row 5 lived 6 mo → 4 of 5
const now = new Date('2025-01-10T00:00').getTime();
eq('survival_at 12', M('survival_at')(book, 12, now).value, 0.8);
// Finished a 12-month term: same 5 eligible (13+ months old); row 5 did not → 4 of 5
eq('finished_term_rate 12', M('finished_term_rate')(book, 12, now).value, 0.8);
// Median life of cancels: lives ≈ 6.0 and 14.0 months → upper middle = 14.0
eq('median_cancel_life', Math.round(M('median_cancel_life')(book).value), 14);
// Delinquent share: 1 of 2 counted cancels
eq('delinquent_share', M('delinquent_share')(book).value, 0.5);

// ── Customer lives ──
const rows2 = [
  // A: 12-month plan Jan 2023, cancelled as the renewal starts Jan 2024; renewal still active → renewed, alive
  sub({ customer_id: 'A', sold_date: '2023-01-05', initial_service: '2023-01-10', subscription_status: 'Cancelled', subscription_date_canceled: '2024-01-05' }),
  sub({ customer_id: 'A', sold_date: '2024-01-05', initial_service: '2024-01-10', subscription_source: 'Renewal - Loyalty' }),
  // B: renewed Jan 2024, renewal cancelled Jul 2024 → renewed, left 6 months after the decision
  sub({ customer_id: 'B', sold_date: '2023-01-05', initial_service: '2023-01-10', subscription_status: 'Cancelled', subscription_date_canceled: '2024-01-05' }),
  sub({ customer_id: 'B', sold_date: '2024-01-05', initial_service: '2024-01-10', subscription_source: 'Renewal - Loyalty', subscription_status: 'Cancelled', subscription_date_canceled: '2024-07-05' }),
  // C: never renewed, still active past contract end → did not renew, alive
  sub({ customer_id: 'C' }),
  // D: left 3 months in, before contract end → never reached the decision
  sub({ customer_id: 'D', subscription_status: 'Cancelled', subscription_date_canceled: '2023-04-10' }),
];
const lives = S.semCustomerLives(rows2);
eq('customers', lives.size, 4);
const A = lives.get('A'), B = lives.get('B'), C = lives.get('C'), D = lives.get('D');
eq('A alive', A.alive, true); eq('A has renewal', !!A.firstRenewal, true); eq('A subs', A.subs.length, 2);
eq('B alive', B.alive, false); eq('B end', new Date(B.end).toISOString().slice(0, 7), '2024-07');
eq('C reached contract end', S.semReachedContractEnd(C, now), true);
eq('D reached contract end', S.semReachedContractEnd(D, now), false);
const ren = [A, B], anchor = (c) => c.firstRenewal.at;
eq('customer_retention renewed', M('customer_retention')(ren).value, 0.5);
// 12 months after the renewal (Jan 2025, decision is 12+ months old on 2025-01-10): A still here, B left at 6 months → 1 of 2
eq('customer_survival_after 12', M('customer_survival_after')(ren, anchor, 12, now).value, 0.5);
// 24 months: neither decision point is 24 months old → no rate
eq('customer_survival_after 24 (too young)', M('customer_survival_after')(ren, anchor, 24, now).value, null);
// Tenure: A 2023-01-10 → 2025-01-10 = 24.0 mo; B 2023-01-10 → 2024-07-05 ≈ 17.8 mo → average ≈ 20.9
eq('customer_tenure', Math.round(M('customer_tenure')(ren, now).value * 10) / 10, 20.9, 0.11);

// ── Registry hygiene: every metric documents itself ──
for (const m of Object.values(S.SEM_METRICS)) for (const k of ['label', 'meaning', 'formula', 'entity', 'compute']) if (!m[k]) { fail++; console.error('  ✗ metric ' + m.id + ' is missing ' + k); }
for (const m of Object.values(S.SEM_METRICS)) for (const r of (m.rules || [])) if (!S.SEM_RULES[r]) { fail++; console.error('  ✗ metric ' + m.id + ' names an unknown rule ' + r); }
if (fail) { console.error('semantic layer fixtures: ' + fail + ' failure(s)'); process.exit(1); }
console.log('semantic layer fixtures: ' + Object.keys(S.SEM_METRICS).length + ' metrics, all scenarios pass');
