// job_runs is the lock AND the run history AND the health sheet's source.
// The lock is a partial unique index (one `running` row per job name, see
// migrations/20261020_job_runs.sql): a second kick inserts, violates the
// index, and is told a run is already in progress. No advisory locks, no
// extra table, nothing to leak if the process dies — the 5 a.m. kill switch
// marks an abandoned `running` row stale.
import { supabase } from '../config/supabase.js';

export async function acquire(job, { version, dryRun }) {
  const { data, error } = await supabase.from('job_runs')
    .insert({ job, status: 'running', started_at: new Date().toISOString(), version, dry_run: !!dryRun })
    .select('id, started_at').single();
  if (error) {
    if (error.code === '23505') {   // unique violation = lock held
      const { data: cur } = await supabase.from('job_runs').select('id, started_at').eq('job', job).eq('status', 'running').maybeSingle();
      const since = cur && cur.started_at ? Math.round((Date.now() - Date.parse(cur.started_at)) / 60000) : null;
      const e = new Error(job + ' is already running' + (since != null ? ' (started ' + since + ' min ago)' : ''));
      e.code = 'LOCKED'; e.status = 409;
      throw e;
    }
    throw new Error('job_runs insert failed: ' + error.message + ' (run migrations/20261020_job_runs.sql?)');
  }
  return data;
}

export async function finish(runId, { ok, summary, error, dataAsOf, durationMs }) {
  const upd = {
    status: ok ? 'ok' : 'failed',
    finished_at: new Date().toISOString(),
    duration_ms: durationMs,
    summary: summary || null,
    error: error ? String(error).slice(0, 2000) : null,
    data_as_of: dataAsOf || null,
  };
  const { error: uErr } = await supabase.from('job_runs').update(upd).eq('id', runId);
  if (uErr) console.warn(JSON.stringify({ severity: 'WARNING', msg: 'job_runs finish failed', runId, error: uErr.message }));
}

// Kill switch helper: any row `running` longer than its allowance → stale.
export async function releaseStale(maxMinutes = 90) {
  const cutoff = new Date(Date.now() - maxMinutes * 60000).toISOString();
  const { data, error } = await supabase.from('job_runs')
    .update({ status: 'stale', finished_at: new Date().toISOString(), error: 'marked stale by kill switch after ' + maxMinutes + ' min' })
    .eq('status', 'running').lt('started_at', cutoff).select('id, job, started_at');
  if (error) throw new Error('kill switch update failed: ' + error.message);
  return data || [];
}
