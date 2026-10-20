// Sync health at a glance — timestamps only (no data, no secrets).
// Ported from netlify/functions/sync-status.js; the response shape is
// unchanged (the health sheet reads lastRun / recentSnapshots / lastDerive)
// with ONE addition: `jobs` — the latest job_runs row per job, which is what
// the sheet will read once the Netlify heartbeats are gone.
import { supabase } from '../../../config/supabase.js';

async function readJson(file) {
  try {
    const { data } = await supabase.storage.from('reporting').download(file);
    return data ? JSON.parse(await data.text()) : null;
  } catch { return null; }
}

export async function syncStatus() {
  const out = { now: new Date().toISOString() };
  try {
    const { data } = await supabase.from('reporting_uploads')
      .select('id, filename, row_count, uploaded_at')
      .order('uploaded_at', { ascending: false }).limit(5);
    out.recentSnapshots = (data || []).map(r => ({ uploaded_at: r.uploaded_at, filename: r.filename, rows: r.row_count }));
  } catch (e) { out.snapshotsError = String((e && e.message) || e); }
  try {
    const { data } = await supabase.storage.from('reporting').list('indicators', { limit: 10 });
    const blob = (data || []).find(f => f.name === 'latest.json.gz');
    out.indicatorsBlob = blob ? { updated_at: blob.updated_at || blob.created_at || null, bytes: (blob.metadata && blob.metadata.size) || null } : null;
  } catch (e) { out.blobError = String((e && e.message) || e); }
  out.lastRun = await readJson('indicators/sync-heartbeat.json');
  out.lastDerive = await readJson('indicators/derive-heartbeat.json');
  const newest = out.recentSnapshots && out.recentSnapshots[0] && out.recentSnapshots[0].uploaded_at;
  out.minutesSinceLastSnapshot = newest ? Math.round((Date.now() - Date.parse(newest)) / 60000) : null;
  // New: the server's own run history, latest row per job.
  try {
    const { data, error } = await supabase.from('job_runs')
      .select('job, status, started_at, finished_at, duration_ms, summary, error, version')
      .order('started_at', { ascending: false }).limit(100);
    if (!error) {
      const seen = {};
      for (const r of (data || [])) if (!seen[r.job]) seen[r.job] = r;
      out.jobs = seen;
    }
  } catch { /* job_runs not migrated yet — the sheet still has the heartbeats */ }
  return out;
}
