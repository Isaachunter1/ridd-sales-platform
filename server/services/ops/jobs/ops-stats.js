// ┌─ ops-stats ─────────────────────────────────────────────────────────────
// │ Operations weekly stats for the COO tab (per Isaac, Sep 2026) — the
// │ "OPS 26" sheet, from the RevHawk mirror instead of hand entry: per
// │ office × Sun–Sat week (this year) — appointments completed / scheduled,
// │ reservices, production, routes run, on-site minutes, technician time-
// │ clock hours, FieldRoutes reviews. Published as indicators/ops-stats.json.
// │
// │ Was: netlify/functions/ops-stats-background.js (+ -now, -scheduled).
// │ Schedule carried over as-is: 40 */6 * * *.
// └─────────────────────────────────────────────────────────────────────────
import { job } from '../../../runtime/job.js';
import { fetchOpsRows } from '../functions/fetchOpsRows.js';
import { rollupOfficeWeeks, weekStartOf } from '../functions/rollupOfficeWeeks.js';

export default job('ops-stats', {
  schedule: '40 */6 * * *',
  description: 'Operations weekly stats (COO tab) → reporting/indicators/ops-stats.json',
  heartbeat: 'indicators/ops-stats-heartbeat.json',
  onFail: 'Reporting → Operations keeps showing the last good file until this recovers.',
}, async (ctx) => {
  const yr = ctx.now.getFullYear();
  const start = weekStartOf(yr + '-01-01');            // the Sunday on/before Jan 1 so the first week is whole
  const end = ctx.now.toISOString().slice(0, 10);

  await ctx.stage('querying');
  const rows = await fetchOpsRows({ start, end, log: ctx.log });

  await ctx.stage('rolling-up');
  const payload = rollupOfficeWeeks({ ...rows, start, end, year: yr, generatedAt: ctx.now.toISOString() });

  await ctx.publish('indicators/ops-stats.json', Buffer.from(JSON.stringify(payload)), 'application/json');

  return { officeWeeks: Object.keys(payload.cells).length, weeks: payload.weeks.length, apptRows: rows.appt.length };
});
