// Peak value rule (per Isaac, Nov 19 2026) pinned with a small fixture. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { computePeaks, contractValue, legacyPeaks } from '../services/indicators/functions/peakValues.js';

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

test('a change on the completion day is part of the sale, not a modification', () => {
  const rows = [{ ...base, rec: 75, cv: 1024, at_: '2026-03-10 16:30:00', cid_: 'c1', k: 'recurringCharge', o: '60' }];
  const { peaks, stats } = computePeaks(rows);
  assert.deepEqual(peaks, {});           // value right after the initial = today's → nothing to publish
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
