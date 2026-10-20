// The DASHP morning auto-kill, ported: any job_runs row still `running` past
// its allowance is marked stale (which releases the lock) and reported.
// Registered like any other job so it has a schedule and shows in job_runs.
import { job } from './job.js';
import { releaseStale } from './lock.js';
import { postAdmin } from './slack.js';

export default job('kill-switch', { schedule: '0 5 * * *', tz: 'America/New_York', description: 'Mark abandoned job_runs rows stale so their locks release' }, async (ctx) => {
  const rows = ctx.dryRun ? [] : await releaseStale(90);
  if (rows.length) {
    const line = rows.map(r => r.job + ' (since ' + r.started_at + ')').join(', ');
    ctx.log.warn('released stale runs: ' + line);
    postAdmin('🧹 kill switch released ' + rows.length + ' stale run(s): ' + line);
  }
  return { released: rows.length };
});
