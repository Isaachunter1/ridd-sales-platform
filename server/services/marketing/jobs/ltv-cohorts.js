// ┌─ ltv-cohorts ────────────────────────────────────────────────────────────
// │ Customer lifetime value, by cohort (per Isaac, Nov 18 2026): every
// │ residential customer since 2021 by the month their first recurring
// │ subscription started — collected revenue and survivors by month since
// │ start, grouped by office, by who sold it (Office Staff vs everyone else),
// │ office × seller, and FieldRoutes source. Published as marketing/ltv.json
// │ for the Marketing → Dashboard LTV / CAC tile and its drill-down; the
// │ browser projects young cohorts along the mature curve.
// │ Nightly: cohorts move once a day at most. ~45k rows, ~2.7 GB billed.
// └─────────────────────────────────────────────────────────────────────────
import { job } from '../../../runtime/job.js';
import { sql, getAccessToken, queryObjects } from '../../../config/bigquery.js';
import { rollupLtv, officeNamesFromRoster } from '../functions/rollupLtv.js';

const LTV_SQL = sql(import.meta.url, 'ltvCohorts');
const MAX_K = 47;          // four years of months since start
const START = '2021-01-01';

export default job('ltv-cohorts', {
  schedule: '20 9 * * *',   // 4:20am ET / 2:20am MT — after the night's payments post
  description: 'LTV cohorts (revenue + survival by month since start, by office / seller / source) → reporting/marketing/ltv.json',
  heartbeat: 'indicators/ltv-cohorts-heartbeat.json',
  onFail: 'Marketing → Dashboard keeps the last LTV file; CAC is unaffected.',
}, async (ctx) => {
  await ctx.stage('querying');
  const token = await getAccessToken();
  const rows = await queryObjects(token, LTV_SQL, { start: START, maxk: MAX_K });
  if (!rows.length) throw new Error('ltvCohorts returned no rows');

  await ctx.stage('rolling-up');
  const { data: roster } = await ctx.supabase.from('fieldroutes_employees').select('office_ids, office_name, office_id').limit(2000);
  const today = ctx.now.toISOString().slice(0, 10);
  const payload = rollupLtv(rows, { today, maxK: MAX_K, start: START.slice(0, 7), generatedAt: ctx.now.toISOString(), officeNames: officeNamesFromRoster(roster) });

  await ctx.publish('marketing/ltv.json', Buffer.from(JSON.stringify(payload)), 'application/json');
  return { rows: rows.length, groups: payload.totals.groups, cohorts: payload.totals.cohorts, customers: payload.totals.customers, dataAsOf: today };
});
