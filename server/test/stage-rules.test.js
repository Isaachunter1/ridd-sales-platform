// Fixture rows in, known stage decisions out. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { makePricing, stageSettings, paidSinceDecision, decideStage } from '../services/sync/functions/stageRules.js';

const AL2 = { enabled: true, auto_approve: true, auto_approve_from: '2026-10-12', lock_days: 90, lock_min_services: 2,
  approval: { office: { appt: true, autopay: true, signed: false } } };
const S = stageSettings(AL2);
const { PR, belowMinReason } = makePricing(AL2);
const ctx = (over = {}) => ({ AL2, PR, today: Date.parse('2026-10-28T12:00:00Z'), stamp: '2026-10-28T12:00:00Z',
  paidSince: new Map(), nsfNow: new Set(), belowMin: new Map(), paidBySale: new Map(), OFFICE_PAID_N: S.OFFICE_PAID_N,
  lockDays: S.lockDays, minSvc: S.minSvc, _autoApproveOn: S._autoApproveOn, _upfrontOf: S._upfrontOf, belowMinReason, ...over });
const sale = (o) => ({ id: 's1', crm_subscription_id: '9', sold_date: '2026-10-20', audit_status: 'pending', lock_status: 'pending',
  payroll_processed_at: null, contract_months: 12, notes: '', crm_audit: null, queue_type: 'office', rep_id: 'p1', ...o });
const row = (o) => ({ subscription_id: '9', subscription: 'Pest 4', initial_price: 99, recurring_charge: 53.87, initial_status: 'Completed',
  initial_serviced_date: '2026-10-22', customer_auto_pay: 'CC', subscription_source: 'Facebook', ...o });

test('serviced, autopay, booked → Commissionable', () => {
  assert.deepEqual(decideStage(sale({}), row({}), ctx()), { audit_status: 'serviced', audited_at: '2026-10-28T12:00:00Z' });
});

test('a Failed Audit flag holds a new sale', () => {
  assert.deepEqual(decideStage(sale({ crm_audit: 'failed' }), row({}), ctx()), {});
});

test('cancelled in the CRM before service → Cancelled', () => {
  const u = decideStage(sale({}), row({ initial_serviced_date: null, initial_status: 'Pending', subscription_status: 'Cancelled' }), ctx());
  assert.equal(u.audit_status, 'cancelled');
  assert.match(u.notes, /cancelled in CRM before service/);
});

test('under the recurring minimum → Below Minimums, with the reason', () => {
  // $44.87 carries the $4.87 service fee → plan price $40 < Pest 4's $49.
  const u = decideStage(sale({}), row({ recurring_charge: 44.87 }), ctx());
  assert.equal(u.audit_status, 'below_minimums');
  assert.match(u.notes, /Recurring \$40 < \$49/);
});

test('renewal: serviced on/after the save, no appointment needed', () => {
  const r = row({ subscription_source: 'Renewal - Loyalty', initial_status: '', initial_serviced_date: '2025-06-01', last_completed_date: '2026-10-25', recurring_charge: 53.87 });
  assert.equal(decideStage(sale({}), r, ctx()).audit_status, 'serviced');
});

test('paid since the sale: a decline and no payment → NSF; a later payment flips it back', () => {
  const nsfNow = new Set();
  const x = { id: 's1', customer_number: '#184', sold_date: '2026-10-20', audit_status: 'pending', notes: '', queue_type: 'office' };
  const decl = new Map([['184', [{ cid: '184', d: '2026-10-21', st: '0' }]]]);
  const a = paidSinceDecision(x, decl, { stamp: 'T', _autoApproveOn: S._autoApproveOn, nsfNow });
  assert.equal(a.upd.audit_status, 'nsf');
  assert.ok(nsfNow.has('s1'));
  const paid = new Map([['184', [{ cid: '184', d: '2026-10-23', st: '1', pm: '1', amt: 53.87 }]]]);
  const b = paidSinceDecision({ ...x, audit_status: 'nsf', notes: 'Auto: NSF' }, paid, { stamp: 'T', _autoApproveOn: S._autoApproveOn, nsfNow: new Set() });
  assert.equal(b.upd.audit_status, 'pending');
  assert.equal(b.v.paidAt, '2026-10-23');
});
