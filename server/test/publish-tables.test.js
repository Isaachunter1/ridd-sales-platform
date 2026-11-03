import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crmRow, rowHash, diffCrm, CRM_FIELDS, salesRow } from '../services/indicators/functions/publishTables.js';
import { monthlyArchives } from '../services/indicators/functions/monthlyArchive.js';

const obj = (over = {}) => ({ subscription_id: 101, customer_id: 7, sold_date: '2026-10-01', subscription: 'Pest 4', subscription_status: 'Active',
  subscription_contract_value: '638', first_name: 'A', last_name: 'B', phone: '5550001000', email: '', customer_missing: '', ...over });

test('crmRow mirrors the Netlify worker: blanks → null, ids as strings, customer_missing boolean', () => {
  const r = crmRow(obj());
  assert.equal(r.subscription_id, '101');
  assert.equal(r.customer_id, '7');
  assert.equal(r.email, null);
  assert.equal(r.customer_missing, false);
  assert.deepEqual(Object.keys(r), CRM_FIELDS);
});

test('rowHash is stable and changes with any mirrored column', () => {
  const a = rowHash(crmRow(obj())), b = rowHash(crmRow(obj()));
  assert.equal(a, b);
  assert.notEqual(a, rowHash(crmRow(obj({ subscription_status: 'Inactive' }))));
  assert.notEqual(a, rowHash(crmRow(obj({ phone: '5550001001' }))));
  assert.equal(a, rowHash(crmRow(obj({ not_a_mirrored_field: 'x' }))));
});

test('diffCrm writes only new or changed rows and deletes only ids that left', () => {
  const o1 = obj(), o2 = obj({ subscription_id: 102 }), o3 = obj({ subscription_id: 103 });
  const existing = new Map([
    ['101', rowHash(crmRow(o1))],                                   // unchanged
    ['102', rowHash(crmRow(obj({ subscription_id: 102, phone: '1' })))],   // changed
    ['999', 'gone'],                                                // left the snapshot
  ]);
  const d = diffCrm([o1, o2, o3, obj({ subscription_id: 101 }) /* dupe ignored */], existing);
  assert.deepEqual(d.upserts.map(r => r.subscription_id), ['102', '103']);
  assert.ok(d.upserts.every(r => r.row_hash && r.row_hash.length === 20));
  assert.deepEqual(d.deletes, ['999']);
  assert.equal(d.total, 3);
});

test('a quiet run touches nothing', () => {
  const os = [obj(), obj({ subscription_id: 102 })];
  const existing = new Map(os.map(o => { const r = crmRow(o); return [r.subscription_id, rowHash(r)]; }));
  const d = diffCrm(os, existing);
  assert.equal(d.upserts.length, 0); assert.equal(d.deletes.length, 0);
});

test('salesRow keeps the worker\'s column mapping', () => {
  const r = salesRow({ office: 'ATL', subscription: 'Pest 4', week: '44', contractValue: '638', autoPay: true, age: '3' }, '2026-11-03T00:00:00Z');
  assert.equal(r.computed_at, '2026-11-03T00:00:00Z'); assert.equal(r.week, 44); assert.equal(r.contract_value, 638);
  assert.equal(r.auto_pay, 'true'); assert.equal(r.age, 3); assert.equal(r.rep, null);
});

test('monthlyArchives: closed months only, skips files already present, Sentricon out of MY%', () => {
  const now = new Date('2026-11-03T12:00:00-05:00');
  const rows = [
    { dateSold: '09/15/2026', office: 'ATL', rep: 'R1', repType: 'Sales Rep', contractValue: 100, initialPrice: 50, contract: 24, autoPay: 'Yes', subscription: 'Pest 4' },
    { dateSold: '09/20/2026', office: 'ATL', rep: 'R1', repType: 'Sales Rep', contractValue: 200, initialPrice: 50, contract: 12, autoPay: 'No', subscription: 'Sentricon GA' },
    { dateSold: '11/01/2026', office: 'ATL', rep: 'R1', repType: 'Sales Rep', contractValue: 300, initialPrice: 50, contract: 12, autoPay: 'Yes', subscription: 'Pest 4' },   // current month → out
    { dateSold: '08/02/2026', office: 'CHS', rep: 'R2', repType: 'technician', contractValue: 50, initialPrice: 0, contract: 12, autoPay: 'Yes', subscription: 'Pest 4' },
  ];
  const out = monthlyArchives(rows, new Set(['metrics-2026-08.json.gz']), now);
  assert.deepEqual(out.map(x => x.name), ['metrics-2026-09.json.gz']);
  const s = out[0].snap;
  assert.equal(s.company.sales, 2); assert.equal(s.company.revenue, 300);
  assert.equal(s.company.myPct, 1);           // the Sentricon 12-month is not in the denominator
  assert.equal(s.byDept['Sales Rep'].sales, 2);
  assert.equal(s.byRep.R1.revenue, 300);
});
