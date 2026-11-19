// Sales export notes (per Isaac, Nov 18 2026): rows → per-customer general / cancel lists.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shapeNotes } from '../services/crm/functions/fetchCustomerNotes.js';

test('notes group by customer and kind, cancel rows keep the reason', () => {
  const n = shapeNotes([
    { cid: '1', kind: 'general', type: 'Notes', d: '2026-11-01 10:00:00', who: 'Drew Sauer', text: 'Wants Tuesdays' },
    { cid: '1', kind: 'cancel', type: 'Subscription Cancel', d: '2026-11-05 09:00:00', who: 'Jason Borup', reason: 'Finances', text: 'Paid ECF' },
    { cid: '2', kind: 'general', type: 'Red Note', d: '2026-10-01', who: '', text: 'Dog in yard' },
  ]);
  assert.deepEqual(Object.keys(n), ['1', '2']);
  assert.equal(n['1'].general[0].text, 'Wants Tuesdays'); assert.equal(n['1'].general[0].d, '2026-11-01');
  assert.equal(n['1'].cancel[0].reason, 'Finances'); assert.equal(n['1'].general[0].reason, undefined);
  assert.equal(n['2'].cancel.length, 0);
});
