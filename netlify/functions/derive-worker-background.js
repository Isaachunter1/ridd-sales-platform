// ── DERIVE WORKER — second half of the sync, in its own memory space ─────
// The main sync function (query → snapshot → envelope) was dying OOM the
// moment it stacked the derive's JSON/gzip spike on top of the 90k rows it
// already held (~800MB): heartbeats froze at "snapshot-uploaded", Netlify
// retried, and the shared dataset stayed stale for days. This worker gets a
// FRESH ~1GB: it downloads the snapshot the main run just wrote, derives,
// publishes both dataset blobs, and writes the monthly archive. Nothing
// else lives here, so the spike has the whole budget to itself.
//
//   POST /.netlify/functions/derive-worker-background
//   headers: x-sync-secret
//   body: { path: "snapshots/revhawk-....json.gz", uploadedAt: ISO }
const zlib = require('zlib');
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  const need = process.env.REVHAWK_SYNC_SECRET;
  if (need) {
    const got = (event && event.headers && (event.headers['x-sync-secret'] || event.headers['X-Sync-Secret'])) || '';
    if (got !== need) return { statusCode: 401, body: 'unauthorized' };
  }
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_ROLE = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_ROLE) return { statusCode: 500, body: 'SUPABASE env required' };
  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, { auth: { persistSession: false } });

  const _mb = () => Math.round(process.memoryUsage().rss / 1048576) + 'MB';
  const _hb = async (obj) => {
    try {
      await supabase.storage.from('reporting').upload('indicators/derive-heartbeat.json',
        Buffer.from(JSON.stringify(Object.assign({ at: new Date().toISOString(), rss: _mb() }, obj))),
        { contentType: 'application/json', upsert: true });
    } catch (e) { console.warn('[derive-worker] heartbeat failed', e && e.message); }
  };

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'bad json' }; }
  const path = String(body.path || '');
  const uploadedAt = String(body.uploadedAt || new Date().toISOString());
  if (!path.startsWith('snapshots/')) return { statusCode: 400, body: 'path must be a snapshot' };

  try {
    await _hb({ stage: 'started', path });
    const dl = await supabase.storage.from('reporting').download(path);
    if (dl.error || !dl.data) throw new Error('snapshot download failed: ' + (dl.error && dl.error.message));
    const gzBuf = Buffer.from(await dl.data.arrayBuffer());
    const objects = JSON.parse(zlib.gunzipSync(gzBuf).toString('utf8'));
    await _hb({ stage: 'parsed:' + objects.length + 'rows' });

    const { deriveIndicatorsPayload } = require('../lib/indicators-derive.js');
    const payload = deriveIndicatorsPayload(objects, uploadedAt,
      'RevHawk sync — ' + new Date(uploadedAt).toLocaleDateString('en-US', { timeZone: 'America/New_York' }));
    await _hb({ stage: 'derived' });

    const indGz = zlib.gzipSync(Buffer.from(JSON.stringify(payload)), { level: 6 });
    const { error: indErr } = await supabase.storage.from('reporting')
      .upload('indicators/latest.json.gz', indGz, { contentType: 'application/gzip', upsert: true });
    if (indErr) throw new Error('full blob upload failed: ' + indErr.message);
    await _hb({ stage: 'published', bytes: indGz.length });

    // Rep-sanitized copy — customer identity stripped DURING stringify.
    try {
      const repJson = JSON.stringify(payload, (k, v) => (k === 'customer' || k === 'customerId') ? undefined : v);
      const repGz = zlib.gzipSync(Buffer.from(repJson), { level: 6 });
      const { error: repErr } = await supabase.storage.from('reporting')
        .upload('indicators/latest-rep.json.gz', repGz, { contentType: 'application/gzip', upsert: true });
      if (repErr) console.error('[derive-worker] rep blob failed:', repErr.message);
      else await _hb({ stage: 'rep-published', bytes: repGz.length });
    } catch (repEx) { console.error('[derive-worker] rep blob failed', repEx); }

    // ── Monthly metric archive — ORIGINAL logic, transplanted with the
    // derive (it reads payload.rawSales).
    // ── 📚 MONTHLY METRIC ARCHIVE (best-effort) ──────────────────────
    // Every CLOSED month missing from snapshots/ gets written as
    // metrics-YYYY-MM.json.gz: company / per-office / per-department /
    // per-rep rollups for that month. The first run backfills every month
    // in the 3-year dataset; after that it's one new file per month.
    // These blobs are never pruned — history survives the app's data
    // fence, so year-over-year comparisons keep working forever.
    try {
      const { data: _snapList } = await supabase.storage.from('reporting').list('snapshots', { limit: 1000 });
      const _have = new Set((_snapList || []).map(f => f.name));
      const _parseDay = (ds) => { const p = String(ds || '').split(' ')[0].split('/'); if (p.length !== 3) return null; let y = Number(p[2]); if (y < 100) y += 2000; const d = new Date(y, Number(p[0]) - 1, Number(p[1])); return isNaN(d) ? null : d; };
      const _nowNY = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      const _curPeriod = _nowNY.getFullYear() + '-' + String(_nowNY.getMonth() + 1).padStart(2, '0');
      // Bucket the derived sales by month in one pass.
      const _byMonth = {};
      for (const r of payload.rawSales) {
        const d = _parseDay(r.dateSold);
        if (!d) continue;
        const per = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        if (per >= _curPeriod) continue;                       // only CLOSED months
        (_byMonth[per] = _byMonth[per] || []).push(r);
      }
      const DEPT = { 'sales rep': 'Sales Rep', 'technician': 'Technician' };
      let _written = 0;
      for (const per of Object.keys(_byMonth).sort()) {
        const fname = 'metrics-' + per + '.json.gz';
        if (_have.has(fname)) continue;
        const rows = _byMonth[per];
        const mk = () => ({ sales: 0, revenue: 0, initSum: 0, multi: 0, twelve: 0, autoPay: 0, cancelsRaw: 0, reps: new Set() });
        const agg = { company: mk(), byOffice: {}, byDept: {}, byRep: {} };
        for (const r of rows) {
          const office = r.office || 'UNKNOWN';
          const dept = DEPT[String(r.repType || '').toLowerCase()] || 'Office Staff';
          const rep = r.rep || 'Unknown';
          const cv = Number(r.contractValue) || 0;
          for (const t of [agg.company, (agg.byOffice[office] = agg.byOffice[office] || mk()), (agg.byDept[dept] = agg.byDept[dept] || mk())]) {
            t.sales++; t.revenue += cv; t.initSum += Number(r.initialPrice) || 0;
            // MY% drops Sentricon from BOTH sides, matching myBucketOf in
            // app.js and _MY_EXCL_DERIVE in indicators-derive.js. Snapshots
            // are immutable once written, so months already archived keep
            // the old rule - only captures from here on agree with the app.
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
        const snap = {
          period: per, generatedAt: new Date().toISOString(),
          note: 'cancelsRaw = rows carrying any cancel date as of snapshot time; attrition matures after the month closes.',
          company: fin(agg.company),
          byOffice: Object.fromEntries(Object.entries(agg.byOffice).map(([k, v]) => [k, fin(v)])),
          byDept: Object.fromEntries(Object.entries(agg.byDept).map(([k, v]) => [k, fin(v)])),
          byRep: agg.byRep,
        };
        const snapGz = zlib.gzipSync(Buffer.from(JSON.stringify(snap)), { level: 6 });
        const { error: snapErr } = await supabase.storage.from('reporting')
          .upload('snapshots/' + fname, snapGz, { contentType: 'application/gzip', upsert: false });
        if (snapErr && !/exists|duplicate/i.test(snapErr.message || '')) throw new Error(snapErr.message);
        _written++;
      }
      if (_written) console.log('[revhawk-sync] monthly archive: wrote ' + _written + ' snapshot(s)');
    } catch (snapE) {
      console.error('[revhawk-sync] monthly archive skipped:', String((snapE && snapE.message) || snapE));
    }

    // ── Publish the DERIVED dataset as tables (best-effort) ──────────────
    // payload.rawSales is the exact per-sale row set every Indicators page
    // (leaderboard, comps, records, class metrics, sales mix, scorecards)
    // computes from in the browser, and payload.indicatorsData the weekly
    // branch rows. riddmarket reads them via market_feed.indicator_sales /
    // indicator_weekly so it starts from the same rows the app does. Customer
    // identity is stripped (same as the rep blob). Replace-all per run,
    // stamped computed_at = this run.
    try {
      const _cAt = new Date().toISOString();
      let n = 0, chunk = [];
      const flush = async (table) => {
        if (!chunk.length) return;
        const { error } = await supabase.from(table).insert(chunk);
        if (error) throw new Error(table + ': ' + error.message);
        n += chunk.length; chunk = [];
      };
      for (const r of payload.rawSales) {
        chunk.push({ computed_at: _cAt, office: r.office || null, subscription: r.subscription || null, active: r.active || null,
          cancel_reason: r.cancelReason || null, cancel_date: r.cancelDate || null, rep: r.rep || null, rep_id: r.repId || null,
          rep_type: r.repType || null, week: r.week == null ? null : Number(r.week) || null, date_sold: r.dateSold || null,
          status: r.status || null, auto_pay: r.autoPay == null ? null : String(r.autoPay), customer_flags: r.customerFlags || null,
          serviced_date: r.servicedDate || null, initial_status: r.initialStatus || null, age: Number(r.age) || 0,
          source: r.source || null, contract: r.contract == null ? null : String(r.contract),
          initial_price: Number(r.initialPrice) || 0, contract_value: Number(r.contractValue) || 0,
          recurring: Number(r.recurring) || 0, services: Number(r.services) || 0 });
        if (chunk.length >= 1000) await flush('indicator_sales');
      }
      await flush('indicator_sales');
      const nSales = n; n = 0;
      for (const w of payload.indicatorsData) {
        chunk.push({ computed_at: _cAt, week: Number(w.week) || null, date_label: w.date || null, iso_start: w.iso_start || null,
          branch: w.branch || null, sold_accounts: Number(w.sold_accounts) || 0, revenue: Number(w.revenue) || 0,
          avg_initial: Number(w.avg_initial) || 0, avg_initial_count: Number(w.avg_initial_count) || 0,
          auto_pay_pct: Number(w.auto_pay_pct) || 0, audit_fail: Number(w.audit_fail) || 0, last_resort: Number(w.last_resort) || 0,
          multi_years: Number(w.multi_years) || 0, twelve_month: Number(w.twelve_month) || 0, reps: Number(w.reps) || 0 });
        if (chunk.length >= 1000) await flush('indicator_weekly');
      }
      await flush('indicator_weekly');
      for (const t of ['indicator_sales', 'indicator_weekly']) {
        const { error } = await supabase.from(t).delete().lt('computed_at', _cAt);
        if (error) throw new Error(t + ' stale delete: ' + error.message);
      }
      await _hb({ stage: 'derived-tables', sales: nSales, weekly: n });
      console.log('[derive-worker] derived tables: ' + nSales + ' sales, ' + n + ' weekly rows');
    } catch (de) {
      console.error('[derive-worker] derived tables failed (continuing):', String((de && de.message) || de));
    }

    // ── Mirror the snapshot into public.crm_subscriptions (best-effort) ──
    // Same rows the app reads, queryable in SQL (riddmarket reads them via
    // market_feed.crm_subscriptions, which strips names/contact/balance).
    // One row per subscription_id, replaced every run; rows absent from this
    // run are deleted afterwards. Lives HERE, not in the main sync: building
    // the rows on top of the main run's 90k-row heap OOM-killed it (Sep 17
    // 2026, heartbeat frozen at 'snapshot-uploaded'). Streamed in 1000-row
    // chunks so no second copy of the dataset is ever held.
    try {
      const _runAt = new Date().toISOString();
      const F = ['subscription_id','customer_id','sold_date','sold_at','sold_by_id','sold_by','sold_by_type','subscription',
        'subscription_status','initial_status','initial_service','initial_serviced_date','subscription_completed_services',
        'subscription_cancellation_reason','subscription_date_canceled','subscription_source','lead_source','recurring_frequency',
        'agreement_length','annual_recurring_value','subscription_contract_value','initial_price','customer_auto_pay','customer_flags',
        'customer_missing','contract_state','contract_signed_at','county','state','zip_code','office_name','days_past_due',
        'responsible_balance','first_name','last_name','phone','email'];
      const _seen = new Set();
      let chunk = [], n = 0;
      const flush = async () => {
        if (!chunk.length) return;
        const { error } = await supabase.from('crm_subscriptions').upsert(chunk, { onConflict: 'subscription_id' });
        if (error) throw new Error(error.message);
        n += chunk.length; chunk = [];
      };
      for (const o of objects) {
        const sid = o.subscription_id == null ? '' : String(o.subscription_id);
        if (!sid || _seen.has(sid)) continue;
        _seen.add(sid);
        const r = {};
        for (const k of F) { const v = o[k]; r[k] = (v === undefined || v === '') ? null : v; }
        r.subscription_id = sid;
        if (r.customer_id != null) r.customer_id = String(r.customer_id);
        if (r.sold_by_id != null) r.sold_by_id = String(r.sold_by_id);
        r.customer_missing = !!r.customer_missing;
        r.synced_at = _runAt;
        chunk.push(r);
        if (chunk.length >= 1000) await flush();
      }
      await flush();
      const { error: delErr } = await supabase.from('crm_subscriptions').delete().lt('synced_at', _runAt);
      if (delErr) throw new Error('stale delete: ' + delErr.message);
      await _hb({ stage: 'crm-mirrored', rows: n });
      console.log('[derive-worker] crm_subscriptions mirrored: ' + n + ' rows');
    } catch (me) {
      console.error('[derive-worker] crm_subscriptions mirror failed (continuing):', String((me && me.message) || me));
    }

    await _hb({ stage: 'finished', ok: true });
    return { statusCode: 200, body: JSON.stringify({ ok: true }) };
  } catch (e) {
    console.error('[derive-worker]', e);
    await _hb({ stage: 'failed', ok: false, error: String((e && e.message) || e).slice(0, 400) });
    try {
      const hook = process.env.SLACK_ADMIN_WEBHOOK;
      if (hook) await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '🚨 RIDD derive worker FAILED — ' + String((e && e.message) || e).slice(0, 300) }) });
    } catch { /* logs have it */ }
    return { statusCode: 500, body: JSON.stringify({ ok: false, error: String((e && e.message) || e) }) };
  }
};
