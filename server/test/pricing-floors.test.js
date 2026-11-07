// The pricing rules (per Isaac, Nov 7 2026) pinned with examples. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { floorConfig, scorePlan, scoreAddon, scoreContract, scoreSale, planUpdate, matchAddon, recurringNet } from '../services/pay/functions/pricingFloors.js';

const cfg = floorConfig({});
cfg.today = '2027-02-01';

test('config defaults mirror the Pricing tab; loyalty = renewal sheet; termite loyalty = standard', () => {
  assert.deepEqual(cfg.std.plans.pest, [49, 69, 119]);
  assert.deepEqual(cfg.loy.plans.pest, [29, 49, 99]);
  assert.deepEqual(cfg.loy.plans.mole, [49, 69, 119]);
  assert.equal(cfg.loy.termite.recurring, 29);
  assert.equal(cfg.initialMin, 39);
  assert.deepEqual(cfg.addons.mole, [40, 30]);
  assert.deepEqual(cfg.addons.rodent, [20, 10]);
  assert.equal(cfg.start, '2027-01-01');
  const c2 = floorConfig({ pricing: { initial_min: 45, floors: { start: '2026-12-01', addons: { mole: [45, 35] } }, renewal: { termite: { recurring: 25 } } } });
  assert.equal(c2.initialMin, 45); assert.equal(c2.start, '2026-12-01'); assert.deepEqual(c2.addons.mole, [45, 35]); assert.equal(c2.loy.termite.recurring, 25);
});

test('recurring fee comes off only when the charge carries it', () => {
  assert.equal(recurringNet(73.87, 4.87), 69);
  assert.equal(recurringNet(69, 4.87), 69);
  assert.equal(recurringNet(53.87, 4.87), 49);
});

test('office: Pest 6 at $69 ok; $59 Below Minimums; $45 Not Payable; initial $30 Not Payable', () => {
  assert.equal(scorePlan({ name: 'Pest 6', initial: 99, recurring: 69, tier: 'office' }, cfg).status, 'ok');
  const bm = scorePlan({ name: 'Pest 6', initial: 99, recurring: 59, tier: 'office' }, cfg);
  assert.equal(bm.status, 'below_minimums'); assert.match(bm.reasons[0], /\$59 < Standard \$69/);
  assert.equal(scorePlan({ name: 'Pest 6', initial: 99, recurring: 49, tier: 'office' }, cfg).status, 'below_minimums');   // exactly Loyalty = Below Minimums, not Not Payable
  const np = scorePlan({ name: 'Pest 6', initial: 99, recurring: 45, tier: 'office' }, cfg);
  assert.equal(np.status, 'not_payable'); assert.match(np.reasons[0], /< Loyalty \$49/);
  const ini = scorePlan({ name: 'Pest 6', initial: 30, recurring: 69, tier: 'office' }, cfg);
  assert.equal(ini.status, 'not_payable'); assert.match(ini.reasons[0], /Initial \$30 < \$39/);
  assert.equal(scorePlan({ name: 'Pest 6', initial: 39, recurring: 69, tier: 'office' }, cfg).status, 'ok');
  assert.equal(scorePlan({ name: 'Pest 6', initial: 38.99, recurring: 69, tier: 'office' }, cfg).status, 'not_payable');
});

test('field (Sales Reps / Technicians): anything under Standard is Not Payable', () => {
  assert.equal(scorePlan({ name: 'Mosquito 12', initial: 99, recurring: 139, tier: 'field' }, cfg).status, 'ok');
  const r = scorePlan({ name: 'Mosquito 12', initial: 99, recurring: 138.99, tier: 'field' }, cfg);
  assert.equal(r.status, 'not_payable'); assert.match(r.reasons[0], /Standard/);
});

test('termite: loyalty = standard, so under $29 recurring is Not Payable for everyone', () => {
  assert.equal(scorePlan({ name: 'Termite Defense', initial: 399, recurring: 29, tier: 'office' }, cfg).status, 'ok');
  assert.equal(scorePlan({ name: 'Termite Defense', initial: 399, recurring: 28, tier: 'office' }, cfg).status, 'not_payable');
  assert.equal(scorePlan({ name: 'Termite Defense', initial: 350, recurring: 29, tier: 'office' }, cfg).status, 'not_payable');
});

test('renewals: under Loyalty is flagged for an auditor, never scored; one-time and unknown plans', () => {
  const r = scorePlan({ name: 'Pest 4', initial: 0, recurring: 25, renewal: true, tier: 'office' }, cfg);
  assert.equal(r.status, 'flagged_for_audit'); assert.match(r.flags[0], /grandfathered/);
  assert.equal(scorePlan({ name: 'Pest 4', initial: 0, recurring: 29, renewal: true, tier: 'office' }, cfg).status, 'ok');
  assert.equal(scorePlan({ name: 'One Time Pest', initial: 99, recurring: 0, tier: 'office' }, cfg).status, 'ok');
  const u = scorePlan({ name: 'Sentricon', initial: 999, recurring: 0, tier: 'office' }, cfg);
  assert.equal(u.status, 'flagged_for_audit'); assert.match(u.flags[0], /No pricing sheet/);
});

test('add-ons: Mole $40 ok, $35 Below Minimums, $29.99 Not Payable; field under Standard Not Payable; unknown flagged', () => {
  assert.equal(matchAddon('Mole Add-On'), 'mole'); assert.equal(matchAddon('Rodent add on'), 'rodent'); assert.equal(matchAddon('Seasonal Mosquito'), 'seasonal'); assert.equal(matchAddon('Gutter guard'), null);
  assert.equal(scoreAddon({ name: 'Mole Add-On', amount: 40, tier: 'office' }, cfg).status, 'ok');
  assert.equal(scoreAddon({ name: 'Mole Add-On', amount: 35, tier: 'office' }, cfg).status, 'below_minimums');
  assert.equal(scoreAddon({ name: 'Mole Add-On', amount: 30, tier: 'office' }, cfg).status, 'below_minimums');
  assert.equal(scoreAddon({ name: 'Mole Add-On', amount: 29.99, tier: 'office' }, cfg).status, 'not_payable');
  assert.equal(scoreAddon({ name: 'Rodent Add-On', amount: 19, tier: 'field' }, cfg).status, 'not_payable');
  assert.equal(scoreAddon({ name: 'Gutter guard', amount: 50, tier: 'office' }, cfg).status, 'flagged_for_audit');
});

test('contract: unsigned = Not Payable; scheduled without a signature carries the red flag; one-time exempt; grace', () => {
  const r = scoreContract({ contractState: 'sent', scheduled: true, oneTime: false, daysSinceSale: 3 }, cfg);
  assert.equal(r.status, 'not_payable'); assert.deepEqual(r.flags, ['Scheduled without a signed contract']);
  assert.equal(scoreContract({ contractState: 'signed', scheduled: true, oneTime: false, daysSinceSale: 3 }, cfg).status, 'ok');
  assert.equal(scoreContract({ contractState: 'none', scheduled: false, oneTime: true, daysSinceSale: 3 }, cfg).status, 'ok');
  const g = scoreContract({ contractState: 'none', scheduled: true, oneTime: false, daysSinceSale: 0 }, { ...cfg, unsignedGraceDays: 1 });
  assert.equal(g.status, 'ok'); assert.equal(g.flags.length, 1);
});

const base = (o) => ({ id: 1, sale_kind: 'sale', queue_type: 'office', crm_subscription: 'Pest 6', contract_months: 12, sold_date: '2027-01-10', crm_contract_state: 'signed', crm_initial_status: 'Pending', audit_status: 'pending', ...o });
const sub = (o) => ({ subscription: 'Pest 6', initial_price: 99, recurring_charge: 69, subscription_source: 'Web', ...o });

test('sold-together rule: a same-day add-on under its floor drags the base sale; a later one does not', () => {
  const s = base({ sub: sub() });
  const r1 = scoreSale(s, cfg, [{ crm_subscription: 'Rodent Add-On', revenue_amount: 15, sold_date: '2027-01-10' }]);
  assert.equal(r1.status, 'below_minimums'); assert.match(r1.reasons[0], /Sold with it: Rodent add-on \$15 < Standard \$20/); assert.match(r1.flags[0], /pulled this account to Below Minimums/);
  const r2 = scoreSale(s, cfg, [{ crm_subscription: 'Rodent Add-On', revenue_amount: 5, sold_date: '2027-01-10' }]);
  assert.equal(r2.status, 'not_payable');
  assert.equal(scoreSale(s, cfg, []).status, 'ok');   // the later add-on is scored on its own row
  assert.equal(scoreSale({ ...base({ sale_kind: 'upsell', crm_subscription: 'Rodent Add-On', revenue_amount: 15 }) }, cfg).status, 'below_minimums');
});

test('scoreSale: unsigned + under Loyalty = Not Payable with both reasons; signed Loyalty price = Below Minimums', () => {
  const r = scoreSale(base({ crm_contract_state: 'sent', sub: sub({ recurring_charge: 45 }) }), cfg);
  assert.equal(r.status, 'not_payable'); assert.equal(r.reasons.length, 2);
  assert.equal(scoreSale(base({ sub: sub({ recurring_charge: 49 }) }), cfg).status, 'below_minimums');
});

test('planUpdate: writes, reverses only its own decisions, never touches a manual pick, keeps an approval on a plain flag', () => {
  const stamp = '2027-02-01T00:00:00Z';
  const np = { status: 'not_payable', reasons: ['No signed contract'], flags: ['Scheduled without a signed contract'] };
  const u1 = planUpdate(base({ notes: 'x' }), np, stamp);
  assert.equal(u1.audit_status, 'not_payable'); assert.equal(u1.status_set_by, 'pricing-floors'); assert.match(u1.notes, /Auto: pricing — Not Payable — No signed contract/); assert.equal(u1.audit_flag, 'Scheduled without a signed contract'); assert.equal(u1.crm_below_min, 'No signed contract');
  // Signed later: back to Pending, flag cleared.
  const ok = { status: 'ok', reasons: [], flags: [] };
  const u2 = planUpdate(base({ audit_status: 'not_payable', status_set_by: 'pricing-floors', audit_flag: 'Scheduled without a signed contract', audit_flag_by: 'pricing-floors', crm_below_min: 'No signed contract', payroll_skipped_at: stamp }), ok, stamp);
  assert.equal(u2.audit_status, 'pending'); assert.equal(u2.status_set_by, null); assert.equal(u2.audit_flag, null); assert.equal(u2.crm_below_min, null); assert.equal(u2.payroll_skipped_at, null); assert.match(u2.notes, /contract signed/);
  // The sync's own Below Minimums (not mine) that now scores ok: left to the sync.
  assert.equal(planUpdate(base({ audit_status: 'below_minimums', status_set_by: null }), ok, stamp), null);
  // Manual pick: untouched whatever the score.
  assert.equal(planUpdate(base({ audit_status: 'serviced', status_set_by: 'manual' }), np, stamp), null);
  // Approved sale, renewal-style flag only: approval stays, flag carried.
  const u3 = planUpdate(base({ audit_status: 'serviced' }), { status: 'flagged_for_audit', reasons: [], flags: ['Renewal recurring $25 < Loyalty $29 — grandfathered pricing?'] }, stamp);
  assert.equal(u3.audit_status, undefined); assert.match(u3.audit_flag, /grandfathered/);
  // Same status already, nothing new: no write.
  assert.equal(planUpdate(base({ audit_status: 'not_payable', status_set_by: 'pricing-floors', crm_below_min: 'No signed contract', audit_flag: 'Scheduled without a signed contract', audit_flag_by: 'pricing-floors' }), np, stamp), null);
});
