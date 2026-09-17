#!/usr/bin/env node
// engine/test/smoke.js — the engine must build and every scorer must run
// standalone (no app globals) on synthetic rows. Runs in `npm run check`
// and the Netlify build, so a helper that quietly starts depending on
// something app-only fails the deploy instead of Cam's server.
const path = require('path');
const E = require(path.join(__dirname, '..', 'dist', 'ridd-engine.js'));
const sales = [];
const reps = ['Murray, Karson', 'Beaird, Ethan', 'Hunter, Sam', 'Grayek, Reggie', 'Holcomb, Case', 'Terry, Caleb'];
for (let i = 0; i < 600; i++) {
  const d = new Date(2026, 2 + Math.floor(i / 60), 1 + (i % 28));
  sales.push({ rep: reps[i % reps.length], repType: 'Sales Rep', office: ['Atlanta', 'Destin', 'Raleigh'][i % 3],
    dateSold: (d.getMonth() + 1) + '/' + d.getDate() + '/' + d.getFullYear(), contractValue: 600 + (i % 90) * 7, initialPrice: 99 + (i % 3) * 50,
    subscription: i % 11 === 0 ? 'Sentricon' : 'Pest 4', customerFlags: i % 3 ? 'Passed Audit' : '', status: 'Serviced', services: i % 2 ? 1 : 0,
    initialStatus: 'Completed', customerId: String(1000 + i), source: 'Door to Door', autoPay: i % 5 ? 'Yes' : 'No' });
}
const eng = E.createEngine({ sales, config: { competitions: { active: 'nrla', repAlias: { 'Karson  Murray': 'Murray, Karson' } }, rep_tiers: { 'Grayek, Reggie': 'rookie' } } });
const assert = (c, m) => { if (!c) { console.error('  ✗ engine smoke: ' + m); process.exit(1); } };
assert(eng.version === E.version, 'version mismatch');
assert(eng.competitions().length >= 4, 'competitions list');
const nrla = eng.comps.nrla(); assert(nrla && Array.isArray(nrla.teams) && nrla.teams.length, 'nrla teams');
const sc = eng.comps.springCleaning(); assert(sc && Array.isArray(sc.ranked), 'spring cleaning ranked');
const tg = eng.comps.topGun(); assert(tg && tg.rookie && tg.vet, 'top gun buckets');
const kb = eng.comps.kobeWeek(); assert(Array.isArray(kb) && kb.length === reps.length, 'kobe week one row per rep');
const lms = eng.comps.lastManStanding(); assert(lms && Array.isArray(lms.alive), 'last man standing');
assert(eng.helpers.canonicalRepName('Karson  Murray') === 'Murray, Karson', 'alias map applied');
assert(eng.helpers.repTier('Grayek, Reggie') === 'rookie', 'tier map applied');
// determinism: same inputs → same JSON
const a = JSON.stringify(eng.comps.nrla()), b = JSON.stringify(E.createEngine({ sales, config: { competitions: { active: 'nrla', repAlias: { 'Karson  Murray': 'Murray, Karson' } }, rep_tiers: { 'Grayek, Reggie': 'rookie' } } }).comps.nrla());
assert(a === b, 'deterministic');
console.log('  ✓ engine smoke: v' + E.version + ' — nrla ' + nrla.teams.length + ' teams · spring ' + sc.ranked.length + ' ranked · kobe ' + kb.length + ' reps · lms ' + lms.alive.length + ' alive · deterministic');
