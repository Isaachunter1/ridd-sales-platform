// ── Sync health at a glance ─────────────────────────────────────────────
// GET /api/sync-status → timestamps only (no data, no secrets):
//   • the last few snapshot envelopes (proves whether hourly runs reach
//     BigQuery and come back with rows)
//   • the shared indicators blob's storage stamp (proves whether the derive
//     publishes — this is what the app header reads)
//   • server "now" for easy math
// If envelopes stop appearing hourly, the TRIGGER or BigQuery is failing.
// If envelopes appear but the blob stamp lags, the DERIVE/publish step fails.
const { createClient } = require('@supabase/supabase-js');

exports.handler = async () => {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: 'server env missing' }) };
  }
  const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const out = { now: new Date().toISOString() };
  try {
    const { data } = await supabase.from('reporting_uploads')
      .select('id, filename, row_count, uploaded_at')
      .order('uploaded_at', { ascending: false })
      .limit(5);
    out.recentSnapshots = (data || []).map(r => ({
      uploaded_at: r.uploaded_at, filename: r.filename, rows: r.row_count,
    }));
  } catch (e) { out.snapshotsError = String((e && e.message) || e); }
  try {
    const { data } = await supabase.storage.from('reporting').list('indicators', { limit: 10 });
    const blob = (data || []).find(f => f.name === 'latest.json.gz');
    out.indicatorsBlob = blob
      ? { updated_at: blob.updated_at || blob.created_at || null, bytes: (blob.metadata && blob.metadata.size) || null }
      : null;
  } catch (e) { out.blobError = String((e && e.message) || e); }
  try {
    const { data } = await supabase.storage.from('reporting').download('indicators/sync-heartbeat.json');
    if (data) out.lastRun = JSON.parse(await data.text());
  } catch (e) { out.lastRun = null; }
  const newest = out.recentSnapshots && out.recentSnapshots[0] && out.recentSnapshots[0].uploaded_at;
  out.minutesSinceLastSnapshot = newest ? Math.round((Date.now() - Date.parse(newest)) / 60000) : null;
  return {
    statusCode: 200,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(out, null, 2),
  };
};
