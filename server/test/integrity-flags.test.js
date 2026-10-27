// Fixture rows in, known flags out. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { integrityFlags, digitDiff, editDistance } from '../services/crm/functions/integrityFlags.js';

test('digitDiff / editDistance', () => {
  assert.equal(digitDiff('(801) 555-1234', '801-555-1235'), 1);
  assert.equal(digitDiff('8015551234', '8015551234'), 0);
  assert.equal(digitDiff('555-1234', '8015551234'), null);
  assert.equal(editDistance('jane@gmail.com', 'jane@gmial.com'), 2);
  assert.equal(editDistance('jane@gmail.com', 'janex@gmail.com'), 1);
});

const edit = (o) => ({ customer_id: '1', customer_name: 'A B', office_id: '13', changed_at: '2026-10-01T00:00:00Z', sold_on: '2026-09-20', sold_by_id: '50', sold_by_name: 'Rep One', changed_by_id: '60', changed_by_name: 'Office Person', days_after_sale: 11, ...o });

test('change-log edits', () => {
  const f = integrityFlags({ edits: [
    edit({ field: 'phone1', old_value: '8015551234', new_value: '8015551239' }),                                  // one digit, office → amber
    edit({ field: 'phone1', old_value: '8015551234', new_value: '8015559999', customer_id: '2' }),                // four digits → not flagged
    edit({ field: 'email', old_value: 'ann1@gmail.com', new_value: 'ann7@gmail.com', changed_by_id: '51', changed_by_name: 'Rep One' }),   // one char, same provider → amber
    edit({ field: 'email', old_value: 'ann@gmial.com', new_value: 'ann@gmail.com' }),                             // typo fix in the domain → not flagged
    edit({ field: 'phone2', old_value: '8015551234', new_value: '8015551238', changed_by_id: '51', changed_by_name: 'Rep One' }),   // seller under another login → red
    edit({ field: 'aPay', old_value: '1', new_value: '0', changed_by_id: '0', changed_by_name: null }),           // FieldRoutes' own shut-off → not flagged
    edit({ field: 'aPay', old_value: '2', new_value: '0', days_after_sale: 9 }),                                   // person, 9 days → red
    edit({ field: 'aPay', old_value: '1', new_value: '0', days_after_sale: 90 }),                                  // too long after the sale → not flagged
  ] });
  assert.deepEqual(f.map(x => x.kind + ':' + x.severity), ['phone_one_digit:amber', 'email_small_edit:amber', 'phone_one_digit:red', 'autopay_off:red']);
  assert.equal(f[3].old_value, 'ACH');
});

const cust = (o) => ({ customer_id: '1', link_group: '1', fname: 'Ann', lname: 'Lee', office_id: '13', phone1: '', email: '', address: '', zip: '', sold_by_id: '50', sold_by_name: 'Rep One', ...o });

test('rep own contact + shared details', () => {
  const f = integrityFlags({
    employees: [{ id: '50', name: 'Rep One', phone: '801-222-3333', email: 'rep1@gmail.com' }],
    contacts: [
      cust({ customer_id: '10', email: 'rep1@gmail.com' }),                                                       // rep's own email → red
      cust({ customer_id: '11', phone1: '8014445555', lname: 'Lee' }),
      cust({ customer_id: '12', phone1: '8014445555', lname: 'Lee', link_group: '12' }),                           // same last name, unlinked → amber "link"
      cust({ customer_id: '13', phone1: '8017778888', lname: 'Lee' }),
      cust({ customer_id: '14', phone1: '8017778888', lname: 'Park', link_group: '14' }),                          // different names, same seller → red
      cust({ customer_id: '15', phone1: '8019990000', link_group: '15' }),
      cust({ customer_id: '16', phone1: '8019990000', link_group: '15' }),                                         // linked → not flagged
      cust({ customer_id: '17', email: 'none@none.com' }), cust({ customer_id: '18', email: 'none@none.com', link_group: '18', lname: 'X' }),   // placeholder → ignored
      cust({ customer_id: '19', card_last4: '4242', card_exp: '0928', lname: 'Lee' }),
      cust({ customer_id: '20', card_last4: '4242', card_exp: '0928', lname: 'Kim', link_group: '20' }),          // same card, different names → red
    ],
  });
  const by = (id) => f.filter(x => x.customer_id === id).map(x => x.kind + ':' + x.severity).sort();
  assert.deepEqual(by('10'), ['rep_own_contact:red']);
  assert.deepEqual(by('11'), ['shared_contact:amber']);
  assert.deepEqual(by('13'), ['shared_contact:red']);
  assert.deepEqual(by('15'), []);
  assert.deepEqual(by('17'), []);
  assert.deepEqual(by('19'), ['shared_card:red']);
  assert.deepEqual(f.find(x => x.customer_id === '11').related_customer_ids, ['12']);
});

test('summary tallies by rep', async () => {
  const { summarize } = await import('../services/crm/functions/integrityFlags.js');
  const s = summarize([{ kind: 'autopay_off', severity: 'red', rep_name: 'A' }, { kind: 'shared_contact', severity: 'amber', rep_name: 'B' }, { kind: 'shared_contact', severity: 'amber', rep_name: 'B' }]);
  assert.equal(s.total, 3); assert.equal(s.red, 1);
  assert.deepEqual(s.topReps, [['A', 1, 1], ['B', 0, 2]]);
});
