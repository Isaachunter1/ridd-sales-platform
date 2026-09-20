#!/usr/bin/env node
// ════════════════════════════════════════════════════════════════════════
// UPSELL RECORD FIXTURES (P3-6 in AUDIT.md) — pins how a FieldRoutes
// ticket line item becomes an app `sales` row (netlify/lib/upsell-record.js).
// The upsell build lands on top of this shape; any drift fails the deploy.
// ════════════════════════════════════════════════════════════════════════
'use strict';
const assert = require('assert');
const { makeIsAddOn, upsellCandidates, upsellSaleRow, QUEUE_OF_TYPE } = require('../netlify/lib/upsell-record.js');
let n = 0; const t = (name, fn) => { fn(); n++; };

const ticket = {
  ticket_id: 88123, customer_id: 162269, subscription_id: 5551, office_id: '7',
  first_name: 'Joy', last_name: 'Bullard', created: '2026-09-14T15:22:00Z', created_by: '301', created_by_type: '1',
};

t('isAddOn: default regex (no configured terms)', () => {
  const f = makeIsAddOn([]);
  assert.strictEqual(f('Termite Add-On'), true);
  assert.strictEqual(f('Mosquito addon'), true);
  assert.strictEqual(f('Upsell - Rodent'), true);
  assert.strictEqual(f('Quarterly Pest'), false);
});
t('isAddOn: configured terms win, substring + case-insensitive', () => {
  const f = makeIsAddOn(['mosquito', 'Rodent']);
  assert.strictEqual(f('Mosquito Add-On'), true);
  assert.strictEqual(f('rodent exclusion'), true);
  assert.strictEqual(f('Termite Add-On'), false);   // add-on but not a configured term
});
t('candidates: one per qualifying line, amount = price × qty, ticket_id suffixed by index', () => {
  const items = JSON.stringify([
    { description: 'Mosquito Add-On', price: 49.5, quantity: 2 },
    { description: 'Quarterly Pest', price: 120 },            // not an add-on
    { name: 'Rodent Upsell', total: 199.99, quantity: 3 },     // total wins over qty
    { description: 'Free Add-On', price: 0 },                  // zero → dropped
  ]);
  const c = upsellCandidates({ ...ticket, items }, makeIsAddOn([]));
  assert.strictEqual(c.length, 2);
  assert.deepStrictEqual(c.map(x => x.ticket_id), ['88123:0', '88123:2']);
  assert.deepStrictEqual(c.map(x => x.total), [99, 199.99]);
  assert.deepStrictEqual(c.map(x => x.service), ['Mosquito Add-On', 'Rodent Upsell']);
  assert.strictEqual(c[0].created_by, '301');                  // falls back to the ticket creator
});
t('candidates: item-level employee overrides ticket creator', () => {
  const items = [{ description: 'Mosquito Add-On', amount: 60, employeeID: 777 }];
  const c = upsellCandidates({ ...ticket, items }, makeIsAddOn([]));
  assert.strictEqual(c[0].created_by, '777');
});
t('candidates: object-keyed items and bad JSON', () => {
  const c1 = upsellCandidates({ ...ticket, items: { a: { description: 'Add-On X', charge: 10 } } }, makeIsAddOn([]));
  assert.strictEqual(c1.length, 1); assert.strictEqual(c1[0].total, 10);
  assert.deepStrictEqual(upsellCandidates({ ...ticket, items: '{not json' }, makeIsAddOn([])), []);
  assert.deepStrictEqual(upsellCandidates({ ...ticket, items: '' }, makeIsAddOn([])), []);
});
t('sale row: the full shape', () => {
  const c = upsellCandidates({ ...ticket, items: [{ description: 'Mosquito Add-On', price: 49.5, quantity: 2 }] }, makeIsAddOn([]))[0];
  const row = upsellSaleRow(c, { repId: 'prof-1', officeId: 'off-7', serviceTypeId: 'svc-9', now: '2026-09-15T00:00:00.000Z' });
  assert.deepStrictEqual(row, {
    rep_id: 'prof-1', logged_by: null,
    sale_kind: 'upsell', crm_ticket_id: '88123:0', parent_subscription_id: '5551',
    queue_type: 'tech',
    customer_name: 'Joy Bullard', customer_number: '162269',
    office_id: 'off-7', service_type_id: 'svc-9',
    contract_months: 0, initial_amount: 99, monthly_amount: 0, num_services: null, pay_per_service: false,
    paid_in_full: true, is_commercial: false, revenue_amount: 99,
    sold_date: '2026-09-14', commission_date: null,
    notes: 'Auto-added upsell (add-on item) from FieldRoutes ticket #88123',
    audit_status: 'pending', created_at: '2026-09-15T00:00:00.000Z',
    crm_status: 'verified', crm_contract_value: 99, crm_subscription: 'Mosquito Add-On', crm_checked_at: '2026-09-15T00:00:00.000Z',
  });
});
t('sale row: queue by creator type; office falls back to null; nameless customer', () => {
  assert.deepStrictEqual(QUEUE_OF_TYPE, { '0': 'office', '2': 'd2d', '1': 'tech' });
  const base = { ticket_id: '1:0', service: 'Add-On', total: 5, customer_id: 9, created: '2026-01-02' };
  assert.strictEqual(upsellSaleRow({ ...base, created_by_type: '2' }, { repId: 'p' }).queue_type, 'd2d');
  assert.strictEqual(upsellSaleRow({ ...base, created_by_type: '' }, { repId: 'p' }).queue_type, 'office');
  const r = upsellSaleRow(base, { repId: 'p' });
  assert.strictEqual(r.office_id, null); assert.strictEqual(r.service_type_id, null);
  assert.strictEqual(r.customer_name, 'Customer 9'); assert.strictEqual(r.parent_subscription_id, null);
});
console.log('upsell fixtures: ' + n + ' scenarios passed');
