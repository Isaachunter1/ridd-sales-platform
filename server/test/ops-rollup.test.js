// Ten rows in, known output out — the shape every functions/*.js that
// computes should have. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { rollupOfficeWeeks, weekStartOf } from '../services/ops/functions/rollupOfficeWeeks.js';

test('weekStartOf snaps to the Sunday on/before', () => {
  assert.equal(weekStartOf('2026-01-01'), '2025-12-28');   // Thu → previous Sun
  assert.equal(weekStartOf('2026-10-18'), '2026-10-18');   // Sun stays
  assert.equal(weekStartOf('2026-10-20'), '2026-10-18');   // Tue → Sun
});

test('rollup sums days into office×week cells and keeps the payload shape', () => {
  const out = rollupOfficeWeeks({
    appt: [
      { office_id: '1', d: '2026-10-19', done: 5, sch: 7, resvc: 1, prod: 1200, routes: 2, mins: 300, minsn: 4, rtypes: 'Mosquito|Mosquito|Pest' },
      { office_id: '1', d: '2026-10-20', done: 3, sch: 3, resvc: 0, prod: 800, routes: 1, mins: 90, minsn: 2, rtypes: '' },
      { office_id: '6', d: '2026-10-20', done: 1, sch: 2, resvc: 0, prod: 100, routes: 1, mins: null, minsn: 0, rtypes: null },
    ],
    clock: [{ office_id: '1', d: '2026-10-19', hours: 10.26, people: 2 }, { office_id: '1', d: '2026-10-20', hours: 4.11, people: 3 }],
    reviews: [{ office_id: '1', d: '2026-10-20', n: 2, good: 1 }],
    start: '2026-10-11', end: '2026-10-20', year: 2026, generatedAt: '2026-10-20T17:00:00.000Z',
  });
  assert.deepEqual(out.weeks, ['2026-10-11', '2026-10-18']);
  const slc = out.cells['1|2026-10-18'];
  assert.equal(slc.done, 8); assert.equal(slc.sch, 10); assert.equal(slc.prod, 2000);
  assert.equal(slc.mins, 390); assert.equal(slc.minsn, 6);
  assert.deepEqual(slc.rtypes, { Mosquito: 2, Pest: 1 });
  assert.equal(slc.hours, 14.4);           // rounded to 0.1
  assert.equal(slc.people, 3);             // max, not sum
  assert.equal(slc.fr_reviews, 2); assert.equal(slc.fr_reviews_good, 1);
  assert.equal(out.cells['6|2026-10-18'].mins, 0);
  assert.equal(out.officeNames['20'], 'Little Rock');
  assert.ok(out.definitions.done);
  assert.equal(out.generatedAt, '2026-10-20T17:00:00.000Z');
});
