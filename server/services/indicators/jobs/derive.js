// ┌─ indicators-derive ─────────────────────────────────────────────────────
// │ Second half of the RevHawk sync: the newest snapshot → the shared
// │ Indicators dataset (indicators/latest.json.gz + the rep-sanitized copy),
// │ the monthly metric archive, and the derived tables riddmarket reads
// │ (indicator_sales / indicator_weekly / crm_subscriptions).
// │
// │ Was: netlify/functions/derive-worker-background.js, kicked by the sync
// │ with the snapshot path in the body. Here it finds the work itself: the
// │ newest 'RevHawk live sync' row in reporting_uploads. If that snapshot is
// │ the one the last ok run derived, the run is a no-op — so it can sit on
// │ Cloud Scheduler every few minutes without the sync knowing it exists,
// │ and the frozen Netlify sync keeps kicking its own worker until that
// │ worker is deleted (MIGRATION.md).
// │
// │ Table writes changed on purpose — see functions/publishTables.js: no more
// │ full-copy + delete-all (the 6 GB indicator_sales pile-up of Nov 3 2026),
// │ no more 109k-row upsert when nothing changed. The derive itself is the
// │ verbatim library; the blobs are byte-for-byte what the worker wrote.
// └─────────────────────────────────────────────────────────────────────────
import zlib from 'node:zlib';
import { job } from '../../../runtime/job.js';
import { deriveIndicatorsPayload } from '../functions/deriveIndicators.js';
import { writeMonthlyArchive } from '../functions/monthlyArchive.js';
import { publishIndicatorTables, publishCrmMirror } from '../functions/publishTables.js';

export default job('indicators-derive', {
  schedule: '2-57/5 * * * *',   // two minutes after each */5 sync tick, 24h — a tick with no new snapshot is a no-op
  description: 'Newest RevHawk snapshot → indicators/latest.json.gz (+ rep copy), monthly archive, indicator_sales / indicator_weekly / crm_subscriptions',
  heartbeat: 'indicators/derive-heartbeat.json',
  timeoutMinutes: 20,
  onFail: 'Indicators keep the last good dataset; the derived tables keep the last good run.',
}, async (ctx) => {
  const { supabase, log } = ctx;

  // ── Which snapshot? The newest RevHawk sync envelope. ──
  const { data: env, error: envErr } = await supabase.from('reporting_uploads')
    .select('id, storage_path, uploaded_at, row_count')
    .like('filename', 'RevHawk live sync%')
    .order('uploaded_at', { ascending: false }).limit(1).maybeSingle();
  if (envErr) throw new Error('reporting_uploads: ' + envErr.message);
  if (!env || !env.storage_path) return { skipped: 'no RevHawk snapshot in reporting_uploads' };

  // Already derived? The last ok run records the path it processed.
  const { data: last } = await supabase.from('job_runs').select('summary')
    .eq('job', 'indicators-derive').eq('status', 'ok').order('finished_at', { ascending: false }).limit(1).maybeSingle();
  if (!ctx.dryRun && last && last.summary && last.summary.path === env.storage_path) return { skipped: 'already derived', path: env.storage_path };

  await ctx.stage('downloading');
  const dl = await supabase.storage.from('reporting').download(env.storage_path);
  if (dl.error || !dl.data) throw new Error('snapshot download failed: ' + (dl.error && dl.error.message));
  const objects = JSON.parse(zlib.gunzipSync(Buffer.from(await dl.data.arrayBuffer())).toString('utf8'));
  log.info('snapshot', { path: env.storage_path, rows: objects.length });

  await ctx.stage('deriving');
  const uploadedAt = env.uploaded_at || ctx.now.toISOString();
  const payload = deriveIndicatorsPayload(objects, uploadedAt,
    'RevHawk sync — ' + new Date(uploadedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' }));

  await ctx.stage('publishing');
  const indGz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 6 });
  await ctx.publish('indicators/latest.json.gz', indGz, 'application/gzip');
  // Rep-sanitized copy — customer NAMES stripped during stringify. The FieldRoutes customer
  // number stays (per Isaac, Sep 22): the TV board and the boards must read identically for
  // office staff and admins, and the number alone identifies nobody.
  const repGz = zlib.gzipSync(Buffer.from(JSON.stringify(payload, (k, v) => (k === 'customer') ? undefined : v)), { level: 6 });
  await ctx.publish('indicators/latest-rep.json.gz', repGz, 'application/gzip');

  await ctx.stage('archiving');
  let archived = 0;
  if (ctx.dryRun) log.info('dry run: monthly archive skipped');
  else { try { archived = await writeMonthlyArchive({ supabase, rawSales: payload.rawSales, log, now: ctx.now }); }
         catch (e) { log.error('monthly archive skipped: ' + String((e && e.message) || e)); } }   // best-effort, as before

  const computedAt = ctx.now.toISOString();
  let tables = { sales: 0, weekly: 0, pruned: 0 }, mirror = { total: 0, changed: 0, removed: 0 };
  if (ctx.dryRun) {
    await ctx.publish('indicators/derive-tables-sample.json', Buffer.from(JSON.stringify({ sales: payload.rawSales.slice(0, 20), weekly: payload.indicatorsData.slice(0, 20) }, null, 1)));
  } else {
    await ctx.stage('tables');
    tables = await publishIndicatorTables({ supabase, payload, computedAt, log });
    await ctx.stage('mirroring');
    mirror = await publishCrmMirror({ supabase, objects, syncedAt: computedAt, log });
  }

  return { path: env.storage_path, rows: objects.length, sales: payload.rawSales.length, bytes: indGz.length, repBytes: repGz.length, archived,
    tables: tables.sales, pruned: tables.pruned, mirrorChanged: mirror.changed, mirrorRemoved: mirror.removed, dataAsOf: uploadedAt };
});
