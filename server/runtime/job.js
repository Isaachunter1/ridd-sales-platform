// job(name, opts, fn) — the DASHP bot convention written once.
//
//   export default job('ops-stats', { schedule: '40 */6 * * *', heartbeat: 'indicators/ops-stats-heartbeat.json' }, async (ctx) => {
//     // ctx.log, ctx.bq, ctx.supabase, ctx.now, ctx.dryRun, ctx.stage(), ctx.publish()
//     return { officeWeeks: 412 };          // small summary → the Slack result line + job_runs.summary
//   });
//
// Around the function, in order: Slack wake-up line → job_runs row (the lock;
// 409 if one is running) → fn with a timer → job_runs finished + summary +
// heartbeat → one Slack line. On failure: error on the row, one plain-English
// Slack line, stack to the log, rethrow so the HTTP route answers 500.
//
// DRY_RUN=true (env) or run({ dryRun: true }): no lock, no Slack, no
// heartbeat, and ctx.publish() writes to ./dryrun/<path> on disk instead of
// the bucket — the file you diff against the Netlify output.
import fs from 'node:fs';
import path from 'node:path';
import env, { DRY_RUN } from '../config/env.js';
import { supabase } from '../config/supabase.js';
import { bq } from '../config/bigquery.js';
import { jobLogger } from '../middleware/log.js';
import { acquire, finish } from './lock.js';
import { writeHeartbeat } from './heartbeat.js';
import { postAdmin } from './slack.js';

const fmtMs = (ms) => (ms < 1000 ? ms + ' ms' : Math.round(ms / 100) / 10 + ' s');
const oneLine = (o) => Object.entries(o || {}).map(([k, v]) => k + ' ' + (typeof v === 'object' ? JSON.stringify(v) : v)).join(' · ');

export function job(name, opts, fn) {
  if (typeof opts === 'function') { fn = opts; opts = {}; }
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error('job name must be kebab-case: ' + name);

  async function run({ trigger = 'manual', dryRun = DRY_RUN } = {}) {
    const started = Date.now();
    const log = jobLogger(name, dryRun ? 'dry' : 'pending');
    const dryDir = path.resolve(process.cwd(), 'dryrun');

    let runRow = null;
    if (!dryRun) {
      runRow = await acquire(name, { version: env.JOB_VERSION, dryRun });   // throws 409 LOCKED
      log.info('started', { trigger, runId: runRow.id });
      postAdmin(`▶️ ${name} started (${trigger})`);
    } else {
      log.info('started (dry run — nothing will be written)', { trigger });
    }

    const ctx = {
      log, bq, supabase, env, dryRun,
      now: new Date(),
      trigger,
      // Progress stamps: a run that dies mid-flight leaves its last stage behind.
      stage: async (s) => { log.info('stage ' + s); if (opts.heartbeat && !dryRun) await writeHeartbeat(opts.heartbeat, { stage: s, job: name }); },
      // The one write path for published files. Dry run → disk.
      publish: async (filePath, body, contentType = 'application/json') => {
        if (dryRun) {
          const out = path.join(dryDir, filePath);
          fs.mkdirSync(path.dirname(out), { recursive: true });
          fs.writeFileSync(out, body);
          log.info('dry run: wrote ' + out + ' (' + body.length + ' bytes)');
          return { path: out };
        }
        const { error } = await supabase.storage.from('reporting').upload(filePath, body, { contentType, upsert: true });
        if (error) throw new Error('upload ' + filePath + ' failed: ' + error.message);
        return { path: filePath };
      },
    };

    try {
      const summary = (await fn(ctx)) || {};
      const durationMs = Date.now() - started;
      const line = `✅ ${name} ok in ${fmtMs(durationMs)}` + (Object.keys(summary).length ? ' · ' + oneLine(summary) : '');
      log.info('finished', { durationMs, summary });
      if (!dryRun) {
        await finish(runRow.id, { ok: true, summary, durationMs, dataAsOf: summary.dataAsOf || null });
        if (opts.heartbeat) await writeHeartbeat(opts.heartbeat, { stage: 'finished', ok: true, job: name, ms: durationMs, ...summary });
        postAdmin(line);
      }
      return { ok: true, job: name, dryRun, durationMs, summary, runId: runRow && runRow.id };
    } catch (e) {
      const durationMs = Date.now() - started;
      const msg = String((e && e.message) || e);
      log.error('failed', { durationMs, error: msg, stack: (e && e.stack) || '' });
      if (!dryRun) {
        await finish(runRow.id, { ok: false, error: msg, durationMs });
        if (opts.heartbeat) await writeHeartbeat(opts.heartbeat, { stage: 'failed', ok: false, job: name, error: msg.slice(0, 500) });
        postAdmin(`🚨 ${name} FAILED after ${fmtMs(durationMs)} — ${msg.slice(0, 300)}` + (opts.onFail ? `\n${opts.onFail}` : ''));
      }
      throw e;
    }
  }

  return { name, schedule: opts.schedule || null, tz: opts.tz || null, description: opts.description || '', timeoutMinutes: opts.timeoutMinutes || 60, run };
}

export default job;
