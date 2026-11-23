// Peak value rule (per Isaac, Nov 23 2026: the rep's contract just before the initial was completed) pinned with a small fixture. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePeaks, contractValue, legacyPeaks, SERVICE_FEE } from '../services/indicators/functions/peakValues.js';

const base = { sid: '1', cust: '500', svc: 'Pest 4', rec: 60, ars: 4, bf: 30, cv: 859, init: 199, iq: 249, idisc: 50, done_at: '2026-03-10 14:02:00' };

test('contract value: monthly = initial + 11 × recurring; per-service = initial + services × recurring', () => {
  assert.equal(contractValue({ init: 199, rec: 60, ars: 4, bf: 30 }), 859);
  assert.equal(contractValue({ init: 199, rec: 150, ars: 4, bf: -1 }), 799);
  assert.equal(contractValue({ init: 199, rec: 150, ars: 4, bf: 0 }), 799);
});

// Nov 23 definition: as sold + the selling rep's own later changes + the $4.87 service fee; everyone else's
// changes come back out. Rep 900 sold it; 500 is the office, 700 a tech.
const R = { ...base, rep: '900' };

test('an office save is added back (peak above today)', () => {
  const rows = [{ ...R, rec: 45, cv: 694, at_: '2026-05-02 09:00:00', cid_: 'c2', emp: '500', k: 'recurringCharge', o: '60', n: '45' }];
  const { peaks, stats } = computePeaks(rows);
  assert.equal(peaks['500|pest 4'], 859);
  assert.equal(stats.reduced, 1);
});

test('a tech or office upsell comes off (peak below today)', () => {
  const rows = [{ ...R, rec: 75, cv: 1024, at_: '2026-03-10 16:30:00', cid_: 'c3', emp: '700', k: 'recurringCharge', o: '60', n: '75' }];
  const { peaks, stats } = computePeaks(rows);
  assert.equal(peaks['500|pest 4'], 859);
  assert.equal(stats.upsold, 1);
});

test('the rep\'s own later upsell stays — even after an office cut made before it', () => {
  // sold at $60; office cuts to $50; rep later upsells to $65 → peak = 60 + 15 = $75 → 199 + 75 × 11
  const rows = [
    { ...R, rec: 65, cv: 914, at_: '2026-08-01 09:00:00', cid_: 'c5', emp: '900', k: 'recurringCharge', o: '50', n: '65' },
    { ...R, rec: 65, cv: 914, at_: '2026-05-01 09:00:00', cid_: 'c4', emp: '500', k: 'recurringCharge', o: '60', n: '50' },
  ];
  assert.equal(computePeaks(rows).peaks['500|pest 4'], 199 + 75 * 11);
});

test('a rep\'s change under another of their branch IDs counts as theirs', () => {
  const rows = [{ ...R, rec: 75, cv: 1024, at_: '2026-06-15 10:00:00', cid_: 'c6', emp: '901', k: 'recurringCharge', o: '60', n: '75' }];
  const sameRep = (a, b) => ['900', '901'].includes(String(a)) && ['900', '901'].includes(String(b));
  assert.deepEqual(computePeaks(rows, sameRep).peaks, {});   // as sold + his own upsell = today
  assert.equal(computePeaks(rows).peaks['500|pest 4'], 859);  // without the roster it looks like someone else's
});

test('office changes to services, initial discount and billing frequency come back out', () => {
  const rows = [
    { ...R, rec: 80, ars: 6, bf: 30, cv: 1079, iq: 249, idisc: 50, at_: '2026-07-01 09:00:00', cid_: 'c9', emp: '500', k: 'recurringCharge', o: '70', n: '80' },
    { ...R, rec: 80, ars: 6, bf: 30, cv: 1079, iq: 249, idisc: 50, at_: '2026-05-01 09:00:00', cid_: 'c8', emp: '500', k: 'annualRecurringServices', o: '4', n: '6' },
    { ...R, rec: 80, ars: 6, bf: 30, cv: 1079, iq: 249, idisc: 50, at_: '2026-04-01 09:00:00', cid_: 'c7', emp: '500', k: 'initialDiscount', o: '0', n: '50' },
    { ...R, rec: 80, ars: 6, bf: 30, cv: 1079, iq: 249, idisc: 50, at_: '2026-03-20 09:00:00', cid_: 'c6', emp: '500', k: 'recurringCharge', o: '60', n: '70' },
  ];
  // as sold: initial 249 − 0, recurring 60, monthly → 249 + 660 = 909
  assert.equal(computePeaks(rows).peaks['500|pest 4'], 909);
});

test('legacy rule (the Netlify build) is the high-water mark and only publishes when above today', () => {
  const rows = [{ ...base, rec: 45, cv: 694, at_: '2026-05-02 09:00:00', cid_: 'c2', k: 'recurringCharge', o: '60' }];
  assert.equal(legacyPeaks(rows).peaks['500|pest 4'], 199 + (694 - 199) * (240 / 180));
  const up = [{ ...base, rec: 75, cv: 1024, at_: '2026-06-15 10:00:00', cid_: 'c3', k: 'recurringCharge', o: '60' }];
  assert.deepEqual(legacyPeaks(up).peaks, {});
});

test('the +$4.87 service fee stays in peak whoever adds it; an office save on top of it is added back', () => {
  assert.equal(SERVICE_FEE, 4.87);
  const fee = [{ ...R, rec: 64.87, cv: 912.57, at_: '2026-03-11 09:00:00', cid_: 'f1', emp: '500', k: 'recurringCharge', o: '60', n: '64.87' }];
  assert.deepEqual(computePeaks(fee).peaks, {});
  const save = [
    { ...R, rec: 50, cv: 749, at_: '2026-06-01 09:00:00', cid_: 'f3', emp: '500', k: 'recurringCharge', o: '64.87', n: '50' },
    { ...R, rec: 50, cv: 749, at_: '2026-03-11 09:00:00', cid_: 'f2', emp: '500', k: 'recurringCharge', o: '60', n: '64.87' },
  ];
  assert.equal(computePeaks(save).peaks['500|pest 4'], 912.57);
});
