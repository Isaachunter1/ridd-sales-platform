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

test('a save after the initial: peak is the pre-cut value (above today)', () => {
  const rows = [{ ...base, rec: 45, cv: 694, at_: '2026-05-02 09:00:00', cid_: 'c2', k: 'recurringCharge', o: '60' }];
  const { peaks, stats } = computePeaks(rows);
  assert.equal(peaks['500|pest 4'], 859);
  assert.equal(stats.reduced, 1);
});

test('an upsell after the initial: peak is the pre-upsell value (below today) — it is published too', () => {
  const rows = [{ ...base, rec: 75, cv: 1024, at_: '2026-06-15 10:00:00', cid_: 'c3', k: 'recurringCharge', o: '60' }];
  const { peaks, stats } = computePeaks(rows);
  assert.equal(peaks['500|pest 4'], 859);
  assert.equal(stats.upsold, 1);
});

test('a tech upsell later on the completion day is a modification, not part of the rep\'s sale (Nov 23)', () => {
  const rows = [{ ...base, rec: 75, cv: 1024, at_: '2026-03-10 16:30:00', cid_: 'c1', k: 'recurringCharge', o: '60' }];
  const { peaks, stats } = computePeaks(rows);
  assert.equal(peaks['500|pest 4'], 859);
  assert.equal(stats.upsold, 1);
});

test('a change logged the same second the initial completes is undone too', () => {
  const rows = [{ ...base, rec: 75, cv: 1024, at_: '2026-03-10 14:02:00', cid_: 'c1', k: 'recurringCharge', o: '60' }];
  assert.equal(computePeaks(rows).peaks['500|pest 4'], 859);
});

test('the rep\'s own edit before the initial is completed is part of the sale', () => {
  // the SQL only returns changes at/after completion; one that slips through earlier is still kept
  const rows = [{ ...base, rec: 75, cv: 1024, at_: '2026-03-09 18:00:00', cid_: 'c0', k: 'recurringCharge', o: '60' }];
  const { peaks, stats } = computePeaks(rows);
  assert.deepEqual(peaks, {});
  assert.equal(stats.unchanged, 1);
});

test('several changes walk back newest → oldest; frequency and initial discount count', () => {
  const rows = [
    { ...base, rec: 80, ars: 6, bf: 30, cv: 1079, iq: 249, idisc: 50, at_: '2026-07-01 09:00:00', cid_: 'c9', k: 'recurringCharge', o: '70' },
    { ...base, rec: 80, ars: 6, bf: 30, cv: 1079, iq: 249, idisc: 50, at_: '2026-05-01 09:00:00', cid_: 'c8', k: 'annualRecurringServices', o: '4' },
    { ...base, rec: 80, ars: 6, bf: 30, cv: 1079, iq: 249, idisc: 50, at_: '2026-04-01 09:00:00', cid_: 'c7', k: 'initialDiscount', o: '0' },
    { ...base, rec: 80, ars: 6, bf: 30, cv: 1079, iq: 249, idisc: 50, at_: '2026-03-20 09:00:00', cid_: 'c6', k: 'recurringCharge', o: '60' },
  ];
  const { peaks } = computePeaks(rows);
  // at completion: initial 249 − 0, recurring 60, monthly → 249 + 660 = 909
  assert.equal(peaks['500|pest 4'], 909);
});

test('legacy rule (the Netlify build) is the high-water mark and only publishes when above today', () => {
  const rows = [{ ...base, rec: 45, cv: 694, at_: '2026-05-02 09:00:00', cid_: 'c2', k: 'recurringCharge', o: '60' }];
  assert.equal(legacyPeaks(rows).peaks['500|pest 4'], 199 + (694 - 199) * (240 / 180));
  const up = [{ ...base, rec: 75, cv: 1024, at_: '2026-06-15 10:00:00', cid_: 'c3', k: 'recurringCharge', o: '60' }];
  assert.deepEqual(legacyPeaks(up).peaks, {});
});

test('the +$4.87 service fee after the initial stays in peak; a save on top of it is added back', () => {
  assert.equal(SERVICE_FEE, 4.87);
  // fee only: $60 → $64.87 the day after → peak = today, nothing published
  const fee = [{ ...base, rec: 64.87, cv: 912.57, at_: '2026-03-11 09:00:00', cid_: 'f1', k: 'recurringCharge', o: '60' }];
  assert.deepEqual(computePeaks(fee).peaks, {});
  // fee, then a save to $50: peak = 199 + 64.87 × 11 = 912.57 (the save comes back, the fee stays)
  const save = [
    { ...base, rec: 50, cv: 749, at_: '2026-06-01 09:00:00', cid_: 'f3', k: 'recurringCharge', o: '64.87' },
    { ...base, rec: 50, cv: 749, at_: '2026-03-11 09:00:00', cid_: 'f2', k: 'recurringCharge', o: '60' },
  ];
  assert.equal(computePeaks(save).peaks['500|pest 4'], 912.57);
  // tech upsell at the initial ($60 → $75), then the fee ($79.87): the upsell comes off, the fee stays → 199 + 64.87 × 11
  const up = [
    { ...base, rec: 79.87, cv: 1077.57, at_: '2026-03-11 09:00:00', cid_: 'f5', k: 'recurringCharge', o: '75' },
    { ...base, rec: 79.87, cv: 1077.57, at_: '2026-03-10 16:30:00', cid_: 'f4', k: 'recurringCharge', o: '60' },
  ];
  assert.equal(computePeaks(up).peaks['500|pest 4'], 912.57);
});
