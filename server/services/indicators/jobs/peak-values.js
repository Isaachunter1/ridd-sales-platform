// ┌─ peak-values ────────────────────────────────────────────────────────────
// │ Peak value per account (per Isaac + CSO, Oct 15 2026; rule per Isaac,
// │ Nov 19 2026): what each subscription was worth right after its initial
// │ service was completed, before any later upsell or save. Published as
// │ indicators/peak-values-v2.json → { at, changelog_since, rule, peaks:
// │ { 'customer|plan name (lower)': peak } }, read by the player card's Peak
// │ toggle and the leaderboard's Peak Rev column. Ported from the frozen
// │ Netlify sync (which still writes the old indicators/peak-values.json with
// │ the old high-water-mark rule until it is retired — hence the new path).
// │ Once a day: the change-log scan bills ~2 GB.
// └─────────────────────────────────────────────────────────────────────────
import { job } from '../../../runtime/job.js';
import { sql, getAccessToken, queryObjects, PROJECT, DATASET } from '../../../config/bigquery.js';
import { legacyPeaks } from '../functions/peakValues.js';

const PEAK_SQL = sql(import.meta.url, 'peakValues');
const SINCE_SQL = 'SELECT CAST(MIN(dateChangedDate) AS STRING) AS since FROM `' + PROJECT + '.' + DATASET + '.FieldRoutesChangelog` WHERE classID = 7';
export const PEAK_FILE = 'indicators/peak-values-v2.json';
export const PEAK_RULE = 'value at end of the initial’s completion day: initial + recurring × 11 (monthly) or × annual services (per service)';

export default job('peak-values', {
  schedule: '40 9 * * *',   // 4:40am ET / 2:40am MT, after the night's sync
  description: 'Peak value per subscription (right after the initial, before upsells / saves) → reporting/indicators/peak-values-v2.json',
  heartbeat: 'indicators/peak-values-heartbeat.json',
  onFail: 'The player card and leaderboard keep yesterday’s Peak file; nothing else is affected.',
}, async (ctx) => {
  await ctx.stage('querying');
  const token = await getAccessToken();
  const rows = await queryObjects(token, PEAK_SQL, {});
  const since = await queryObjects(token, SINCE_SQL, {});
  const changelogSince = ((since || [])[0] || {}).since || null;

  await ctx.stage('computing');
  const { peaks, stats } = legacyPeaks(rows);
  const payload = { at: ctx.now.toISOString(), changelog_since: changelogSince, rule: PEAK_RULE, peaks };
  await ctx.publish(PEAK_FILE, Buffer.from(JSON.stringify(payload)), 'application/json');
  return Object.assign({ rows: rows.length, published: Object.keys(peaks).length, changelogSince }, stats);
});
