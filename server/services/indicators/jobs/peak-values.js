// ┌─ peak-values ────────────────────────────────────────────────────────────
// │ Peak value per account (per Isaac + CSO, Oct 15 2026; definition per
// │ Isaac, Nov 23 2026): the contract as the rep sold it + the rep's own
// │ later changes + the $4.87 service fee. Office / tech changes come out. Published as
// │ indicators/peak-values-v2.json → { at, changelog_since, rule, peaks:
// │ { 'customer|plan name (lower)': peak } }, read by the player card's Peak
// │ toggle and the leaderboard's Peak Rev column. Ported from the frozen
// │ Netlify sync (which still writes the old indicators/peak-values.json with
// │ the old high-water-mark rule until it is retired — hence the new path).
// │ Once a day: the change-log scan bills ~10 GB (~33k change rows over ~21k subscriptions, Nov 2026).
// └─────────────────────────────────────────────────────────────────────────
import { job } from '../../../runtime/job.js';
import { sql, getAccessToken, queryObjects, PROJECT, DATASET } from '../../../config/bigquery.js';
import { computePeaks } from '../functions/peakValues.js';

const PEAK_SQL = sql(import.meta.url, '../functions/peakValues');
const SINCE_SQL = 'SELECT CAST(MIN(dateChangedDate) AS STRING) AS since FROM `' + PROJECT + '.' + DATASET + '.FieldRoutesChangelog` WHERE classID = 7';
export const PEAK_FILE = 'indicators/peak-values-v2.json';
export const PEAK_RULE = 'contract as sold + the selling rep’s own later changes + the $4.87 service fee; initial + recurring × 11 (monthly) or × annual services (per service)';

export default job('peak-values', {
  schedule: '40 9 * * *',   // 4:40am ET / 2:40am MT, after the night's sync
  description: 'Peak value per subscription (as sold + the rep’s own changes + service fee) → reporting/indicators/peak-values-v2.json',
  heartbeat: 'indicators/peak-values-heartbeat.json',
  onFail: 'The player card and leaderboard keep yesterday’s Peak file; nothing else is affected.',
}, async (ctx) => {
  await ctx.stage('querying');
  const token = await getAccessToken();
  const rows = await queryObjects(token, PEAK_SQL, {});
  const since = await queryObjects(token, SINCE_SQL, {});
  const changelogSince = ((since || [])[0] || {}).since || null;

  // A rep has one FieldRoutes employee ID per branch (Reggie Grayek: 18639, 18718, 19745) — any of them is the rep.
  const { data: roster } = await ctx.supabase.from('fieldroutes_employees').select('employee_id, employee_ids').limit(5000);
  const person = new Map();
  for (const e of roster || []) {
    const ids = String(e.employee_ids || e.employee_id || '').split(',').map(x => x.trim()).filter(Boolean);
    const who = ids.slice().sort().join(',');
    for (const id of ids) person.set(id, who);
  }
  const sameRep = (a, b) => { a = String(a || ''); b = String(b || ''); if (!a || !b) return false; return a === b || (person.has(a) && person.get(a) === person.get(b)); };

  await ctx.stage('computing');
  const { peaks, stats } = computePeaks(rows, sameRep);
  const payload = { at: ctx.now.toISOString(), changelog_since: changelogSince, rule: PEAK_RULE, peaks };
  await ctx.publish(PEAK_FILE, Buffer.from(JSON.stringify(payload)), 'application/json');
  return Object.assign({ rows: rows.length, published: Object.keys(peaks).length, changelogSince }, stats);
});
