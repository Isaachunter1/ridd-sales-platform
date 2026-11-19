// LTV cohort rollup (per Isaac, Nov 18 2026) pinned with a small fixture. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { rollupLtv, cohortAge, officeNamesFromRoster } from '../services/marketing/functions/rollupLtv.js';

test('cohort age counts closed months only', () => {
  assert.equal(cohortAge('2026-01', '2026-11-18'), 10);
  assert.equal(cohortAge('2026-11', '2026-11-18'), 0);
  assert.equal(cohortAge('2024-11', '2026-11-18'), 24);
});

test('rows roll up into groups × cohorts with rev / alive arrays; unknown months stay null', () => {
  const rows = [
    { grp_kind: 'all', grp_key: 'all', cohort: '2026-09', k: -1, n: 10, rev: 9000, alive: 8 },
    { grp_kind: 'all', grp_key: 'all', cohort: '2026-09', k: 0, rev: 1000, alive: 10 },
    { grp_kind: 'all', grp_key: 'all', cohort: '2026-09', k: 1, rev: 500, alive: 9 },
    { grp_kind: 'office', grp_key: '10', cohort: '2026-09', k: -1, n: 4, rev: 3600, alive: 3 },
    { grp_kind: 'office', grp_key: '10', cohort: '2026-09', k: 0, rev: 400, alive: null },
  ];
  const p = rollupLtv(rows, { today: '2026-11-18', maxK: 3, start: '2021-01', generatedAt: 'x' });
  const c = p.groups['all:all'].cohorts['2026-09'];
  assert.equal(c.n, 10); assert.equal(c.acv, 900); assert.equal(c.aliveNow, 8); assert.equal(c.age, 2);
  assert.deepEqual(c.rev, [1000, 500, 0, 0]);
  assert.deepEqual(c.alive, [10, 9, null, null]);
  const o = p.groups['office:10'].cohorts['2026-09'];
  assert.deepEqual(o.alive, [0, 0, null, null]);   // closed months with no survivor row = 0, not unknown
  assert.equal(p.totals.customers, 10);
});

test('office names come from the roster rows, ids and names zipped in order', () => {
  const names = officeNamesFromRoster([{ office_ids: '1,7,10', office_name: 'Salt Lake, Myrtle Beach, Destin' }, { office_ids: '7', office_name: 'Myrtle Beach' }]);
  assert.deepEqual(names, { 1: 'Salt Lake', 7: 'Myrtle Beach', 10: 'Destin' });
});
