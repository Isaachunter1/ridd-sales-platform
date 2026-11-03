// ┌─ indicators/functions/monthlyArchive.js ────────────────────────────────
// │ Monthly metric archive — ORIGINAL logic from the derive worker, moved
// │ as-is. Every CLOSED month missing from snapshots/ gets written as
// │ metrics-YYYY-MM.json.gz: company / per-office / per-department / per-rep
// │ rollups for that month. The first run backfills every month in the
// │ 3-year dataset; after that it's one new file per month. These blobs are
// │ never pruned — history survives the app's data fence, so year-over-year
// │ comparisons keep working forever.
// │
// │ Was: netlify/functions/derive-worker-background.js (monthly archive block).
// └─────────────────────────────────────────────────────────────────────────
import zlib from 'node:zlib';

const DEPT = { 'sales rep': 'Sales Rep', 'technician': 'Technician' };
const parseDay = (ds) => { const p = String(ds || '').split(' ')[0].split('/'); if (p.length !== 3) return null; let y = Number(p[2]); if (y < 100) y += 2000; const d = new Date(y, Number(p[0]) - 1, Number(p[1])); return isNaN(d) ? null : d; };

// Pure: the archive blobs for every closed month in rawSales that isn't in `have`.
// Returns [{ name, snap }] — the caller uploads. Split out so it can be tested.
export function monthlyArchives(rawSales, have, now = new Date()) {
  const nowNY = new Date(now.toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const curPeriod = nowNY.getFullYear() + '-' + String(nowNY.getMonth() + 1).padStart(2, '0');
  const byMonth = {};
  for (const r of rawSales || []) {
    const d = parseDay(r.dateSold);
    if (!d) continue;
    const per = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    if (per >= curPeriod) continue;                       // only CLOSED months
    (byMonth[per] = byMonth[per] || []).push(r);
  }
  const out = [];
  for (const per of Object.keys(byMonth).sort()) {
    const fname = 'metrics-' + per + '.json.gz';
    if (have.has(fname)) continue;
    const rows = byMonth[per];
    const mk = () => ({ sales: 0, revenue: 0, initSum: 0, multi: 0, twelve: 0, autoPay: 0, cancelsRaw: 0, reps: new Set() });
    const agg = { company: mk(), byOffice: {}, byDept: {}, byRep: {} };
    for (const r of rows) {
      const office = r.office || 'UNKNOWN';
      const dept = DEPT[String(r.repType || '').toLowerCase()] || 'Office Staff';
      const rep = r.rep || 'Unknown';
      const cv = Number(r.contractValue) || 0;
      for (const t of [agg.company, (agg.byOffice[office] = agg.byOffice[office] || mk()), (agg.byDept[dept] = agg.byDept[dept] || mk())]) {
        t.sales++; t.revenue += cv; t.initSum += Number(r.initialPrice) || 0;
        // MY% drops Sentricon from BOTH sides, matching myBucketOf in app.js
        // and _MY_EXCL_DERIVE in deriveIndicators.js. Snapshots are immutable
        // once written, so months already archived keep the old rule — only
        // captures from here on agree with the app.
        if (!/sentricon/i.test(r.subscription || '')) {
          if (Number(r.contract) >= 18) t.multi++;
          else if (Number(r.contract) === 12) t.twelve++;
        }
        if (r.autoPay && r.autoPay !== 'No') t.autoPay++;
        if (r.cancelDate) t.cancelsRaw++;
        t.reps.add(rep);
      }
      const rr = agg.byRep[rep] = agg.byRep[rep] || { sales: 0, revenue: 0, office };
      rr.sales++; rr.revenue += cv;
    }
    const fin = (t) => ({ sales: t.sales, revenue: Math.round(t.revenue), acv: t.sales ? +(t.revenue / t.sales).toFixed(2) : 0, avgInitial: t.sales ? +(t.initSum / t.sales).toFixed(2) : 0, myPct: (t.multi + t.twelve) ? +(t.multi / (t.multi + t.twelve)).toFixed(4) : 0, autoPayPct: t.sales ? +(t.autoPay / t.sales).toFixed(4) : 0, cancelsRaw: t.cancelsRaw, reps: t.reps.size });
    out.push({ name: fname, snap: {
      period: per, generatedAt: now.toISOString(),
      note: 'cancelsRaw = rows carrying any cancel date as of snapshot time; attrition matures after the month closes.',
      company: fin(agg.company),
      byOffice: Object.fromEntries(Object.entries(agg.byOffice).map(([k, v]) => [k, fin(v)])),
      byDept: Object.fromEntries(Object.entries(agg.byDept).map(([k, v]) => [k, fin(v)])),
      byRep: agg.byRep,
    } });
  }
  return out;
}

// Upload every missing month. Best-effort like before: a failure is logged, never fatal.
export async function writeMonthlyArchive({ supabase, rawSales, log, now }) {
  const { data: list } = await supabase.storage.from('reporting').list('snapshots', { limit: 1000 });
  const have = new Set((list || []).map(f => f.name));
  let written = 0;
  for (const { name, snap } of monthlyArchives(rawSales, have, now)) {
    const gz = zlib.gzipSync(Buffer.from(JSON.stringify(snap)), { level: 6 });
    const { error } = await supabase.storage.from('reporting').upload('snapshots/' + name, gz, { contentType: 'application/gzip', upsert: false });
    if (error && !/exists|duplicate/i.test(error.message || '')) throw new Error(error.message);
    written++;
  }
  if (written) log.info('monthly archive: wrote ' + written + ' snapshot(s)');
  return written;
}
