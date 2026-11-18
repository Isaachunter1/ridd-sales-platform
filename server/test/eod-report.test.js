// The end-of-day rep report (per Isaac, Nov 18) pinned with a small fixture. Run: npm test --workspace server
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRepEod, renderEodBlocks, renderTeamBlocks, eodWindows, workDays, isWorkDay, goalFor, saleIso } from '../services/slack/functions/eodReport.js';

// Wed Nov 18 2026, 6:05pm Mountain (01:05Z Nov 19).
const now = new Date('2026-11-19T01:05:00Z');
const prof = { id: 'p1', full_name: 'Drew Sauer', role: 'rep_office', fieldroutes_employee_id: '18330', annual_revenue_goal: 700000, year_goals: {} };
const roster = { employee_id: '18330', employee_ids: '18330,18335,18331' };
const sale = (o) => Object.assign({ rep: 'Drew Sauer', repId: '18335', repType: 'Office Staff', dateSold: '11/18/26 10:00', contract: 12, contractValue: 631.57, subscription: 'Pest 4', source: 'Facebook' }, o);
const rawSales = [
  sale({}),
  sale({ contract: 18, contractValue: 851.57, repId: '18331' }),
  sale({ dateSold: '11/16/26', contract: 24, contractValue: 771.57, subscription: 'Sentricon - Retreat' }),   // Sentricon: out of MY%
  sale({ dateSold: '11/17/26', contract: 12, contractValue: 406.44, source: 'Renewal - Outbound' }),         // renewal: out of ACV + MY%
  sale({ dateSold: '11/03/26', contract: 0, contractValue: 303.87, subscription: 'One Time Service' }),     // one-time: out of ACV
  sale({ dateSold: '11/18/26', repId: '99999', rep: 'Someone Else' }),                                      // not Drew
  sale({ dateSold: '11/18/26', repId: '', rep: 'Sauer, Drew' }),                                            // no id → name match
];
const closeTv = { pulled_at: '2026-11-18T23:17:00Z', windows: { this_month: { reps: { 'drew sauer': { rate: 0.45, sold: 47, qualified: 105 } } }, today: { reps: { 'drew sauer': { rate: 0.5, sold: 2, qualified: 4 } } } } };

test('windows run on the Mountain calendar, Sunday-start weeks', () => {
  const W = eodWindows(now);
  assert.equal(W.today.start, '2026-11-18');
  assert.equal(W.week.start, '2026-11-15');
  assert.equal(W.month.start, '2026-11-01');
  assert.equal(W.year.start, '2026-01-01');
  assert.equal(saleIso({ dateSold: '11/18/26 10:00' }), '2026-11-18');
});

test('work days: Mon–Fri, company holidays off (Thanksgiving + Black Friday 2026)', () => {
  assert.equal(isWorkDay('2026-11-26'), false);
  assert.equal(isWorkDay('2026-11-27'), false);
  assert.equal(isWorkDay('2026-11-21'), false);   // Saturday
  assert.equal(workDays('2026-11-16', '2026-11-20'), 5);
  assert.equal(workDays('2026-11-23', '2026-11-29'), 3);
});

test('goal share = annual ÷ work days in the selling window × work days in range', () => {
  const g = goalFor(prof, { start: '2026-11-16', end: '2026-11-20' }, '2026-11-18');
  const total = workDays('2026-01-01', '2026-12-31');
  assert.ok(Math.abs(g.goal - 700000 * 5 / total) < 0.01);
  assert.equal(g.done, 2); assert.equal(g.left, 3);
  assert.equal(goalFor({ annual_revenue_goal: 0 }, { start: '2026-11-16', end: '2026-11-20' }, '2026-11-18'), null);
});

test('rep metrics: branch ids + name fallback, ACV and MY% exclusions, pace and close rate', () => {
  const m = buildRepEod({ prof, rosterRow: roster, rawSales, closeTv, renewalSources: new Set(['Renewal - Outbound']), now, cfg: {} });
  const T = m.windows.today, M = m.windows.month;
  assert.equal(T.subs, 3);                                   // two by branch id + one by name; "Someone Else" out
  assert.ok(Math.abs(T.revenue - (631.57 * 2 + 851.57)) < 0.01);
  assert.equal(M.subs, 7 - 1);
  assert.equal(M.renewals, 1);
  assert.equal(M.acv_n, 4);                                  // renewal + one-time out
  assert.equal(M.my_n, 3);                                   // Sentricon + renewal out; the one-time is neither 12 nor 18+
  assert.equal(M.multi, 1);
  assert.equal(Math.round(M.my), 33);
  assert.equal(M.pace.left, workDays('2026-11-18', '2026-11-30'));   // days still to come in the month, not just to date
  assert.ok(['ahead', 'behind'].includes(T.pace.status));
  assert.ok(T.pace.goal > 0);
  assert.equal(M.close.sold, 47);
  assert.equal(T.close.sold, 2);
  assert.equal(m.close_stale, null);
});

test('renders Slack blocks with the thresholds in the text', () => {
  const m = buildRepEod({ prof, rosterRow: roster, rawSales, closeTv, renewalSources: null, now, cfg: { acv_min: 700, my_min: 60 } });
  const s = renderEodBlocks(m, { acv_min: 700, my_min: 60 });
  assert.ok(s.blocks.length >= 3);
  const all = JSON.stringify(s.blocks);
  assert.ok(/target \$700\+/.test(all));
  assert.ok(/target 60%\+/.test(all));
  assert.ok(/Close rate/.test(all));
  const t = renderTeamBlocks([m], '2026-11-18');
  assert.ok(/Drew Sauer/.test(JSON.stringify(t.blocks)));
});
