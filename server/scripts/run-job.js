// Run one job from the shell, no HTTP:   npm run job -- ops-stats [--dry]
// With --dry (or DRY_RUN=true in .env) nothing is written; published files
// land in server/dryrun/ for diffing against the Netlify output.
import { createApp } from '../index.js';

const name = process.argv.slice(2).find(a => !a.startsWith('--'));
const dry = process.argv.includes('--dry') ? true : undefined;
if (!name) { console.error('usage: npm run job -- <job-name> [--dry]'); process.exit(2); }

const app = await createApp();
const j = app.locals.jobs.find(x => x.name === name);
if (!j) { console.error('no such job: ' + name + '\navailable: ' + app.locals.jobs.map(x => x.name).join(', ')); process.exit(2); }
try {
  const r = await j.run({ trigger: 'cli', dryRun: dry });
  console.log(JSON.stringify(r, null, 2));
  process.exit(0);
} catch (e) {
  console.error(String((e && e.stack) || e));
  process.exit(1);
}
