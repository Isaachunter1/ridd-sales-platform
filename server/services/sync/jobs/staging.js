// ┌─ staging ───────────────────────────────────────────────────────────────
// │ 🤖 AUTO-STAGE (per Isaac, Sep 2026): CRM-born sales move through the
// │ queues on their own. Reads app_settings.autolog for the rules.
// │   Upfront   → approved  when serviced + signed agreement (or no agreement
// │                         required) + not past due            [auto_approve]
// │             → cancelled when the CRM cancelled it before any service
// │   Backend   → chargeback when the subscription is cancelled
// │             → lock       when the backend indications hold
// │ Payroll runs (upfront + backend) stay the admin's click — they are what
// │ graduate rows to History. Manual (upsell) rows are never touched.
// │
// │ PORTED from netlify/functions/revhawk-sync-background.js (the AUTO-STAGE
// │ block: paid-invoice count, paid-since-sale, pricing minimums, the
// │ approve / cancel / lock pass, add-on chargebacks, Below Minimums stamps).
// │ The decisions are verbatim in functions/stageRules.js. Peak values and
// │ service changes stay in the Netlify worker for now — they publish files,
// │ not sales updates, and port as their own jobs (MIGRATION.md note).
// │
// │ Input: the latest "RevHawk live sync" snapshot the Netlify worker already
// │ uploads (reporting_uploads + the gzipped JSON in the reporting bucket) —
// │ the same rows the Netlify block read, so the port can be checked against
// │ it without re-running the 100k-row snapshot query.
// │
// │ NOT SCHEDULED until the switch: while the Netlify block still runs, a dry
// │ run (POST /api/jobs/staging?dry=1, or npm run job -- staging --dry) lists
// │ what this job WOULD change. Right after a Netlify run that should be
// │ nothing, or only what moved since. The switch PR adds the schedule and
// │ deletes the Netlify block in one go.
// └─────────────────────────────────────────────────────────────────────────
import zlib from 'node:zlib';
import { job } from '../../../runtime/job.js';
import { selectAll } from '../../../config/supabase.js';
import { ticketsForSubsSql, paidCountFrom } from '../functions/invoiceMap.js';
import { makePricing, stageSettings, paidSinceDecision, decideStage } from '../functions/stageRules.js';

// The latest auto-sync snapshot (written by the Netlify worker every 30 min).
async function loadSnapshot(supabase) {
  const { data: env, error } = await supabase.from('reporting_uploads')
    .select('id, storage_path, uploaded_at, row_count').like('filename', 'RevHawk live sync%')
    .order('uploaded_at', { ascending: false }).limit(1).maybeSingle();
  if (error) throw new Error('reporting_uploads read failed: ' + error.message);
  if (!env || !env.storage_path) throw new Error('no RevHawk live sync snapshot found');
  const { data: blob, error: dErr } = await supabase.storage.from('reporting').download(env.storage_path);
  if (dErr || !blob) throw new Error('snapshot download failed: ' + ((dErr && dErr.message) || 'empty'));
  const objects = JSON.parse(zlib.gunzipSync(Buffer.from(await blob.arrayBuffer())).toString('utf8'));
  return { objects, uploadedAt: env.uploaded_at, id: env.id };
}

export default job('staging', {
  description: 'Auto-stage CRM-born sales: approve / cancel / NSF / lock / chargeback, paid-since-sale, pricing minimums',
  timeoutMinutes: 20,
  onFail: 'Sales stop moving through Upfront / Backend on their own until this recovers — nothing is lost, the next run catches up.',
}, async (ctx) => {
  const { supabase, dryRun, log } = ctx;
  const T = (n) => '`' + ctx.bq.PROJECT + '.' + ctx.bq.DATASET + '.' + n + '`';
  const runQuery = async (tok, text) => ctx.bq.runQuery(tok, text, {}, { compact: true });
  // Every sales write goes through here: a dry run records it instead.
  const plan = [];
  const write = async (id, upd, why) => {
    plan.push({ id, why, ...upd });
    if (dryRun) return null;
    const { error } = await supabase.from('sales').update(upd).eq('id', id);
    return error || null;
  };

  let stageCount = 0;
  const { data: alRow2 } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
  const AL2 = Object.assign({ enabled: false, auto_approve: true, lock_days: 90, lock_min_services: 2 }, (alRow2 && alRow2.value) || {});
  if (!AL2.enabled) return { enabled: false };

  await ctx.stage('snapshot');
  const snap = await loadSnapshot(supabase);
  const objects = snap.objects;
  const bySub = new Map();
  for (const r of objects) { const id = String(r.subscription_id || '').trim(); if (id) bySub.set(id, r); }
  const S = stageSettings(AL2);
  const { _autoApproveOn, OFFICE_PAID_N } = S;

  const { data: crmSales, error: csErr } = await selectAll(() => supabase.from('sales')
    .select('id, crm_subscription_id, sold_date, audit_status, lock_status, payroll_processed_at, backend_payroll_processed_at, contract_months, notes, crm_audit, queue_type, crm_contract_state, rep_id')
    .not('crm_subscription_id', 'is', null)
    .or('audit_status.eq.pending,lock_status.eq.pending'));
  if (csErr) throw new Error(csErr.message);
  const stamp = new Date().toISOString();
  const today = Date.now();

  // ── Inside Sales backend lock: paid invoices on the plan, counted once a day per sale.
  await ctx.stage('paid-invoices');
  const paidBySale = new Map();
  try {
    const offIds = (crmSales || []).filter(s => (s.queue_type || 'office') === 'office' && (s.lock_status || 'pending') === 'pending' && s.payroll_processed_at).map(s => s.id);
    const cached = [];
    for (let i = 0; i < offIds.length; i += 500) {
      const { data: pc, error: pe } = await supabase.from('sales').select('id, crm_subscription_id, sold_date, crm_paid_invoices, crm_paid_invoices_at').in('id', offIds.slice(i, i + 500));
      if (pe) throw new Error(pe.message);
      cached.push(...(pc || []));
    }
    const DAY = 20 * 3600000;
    const due = cached.filter(x => !x.crm_paid_invoices_at || (today - Date.parse(x.crm_paid_invoices_at)) > DAY);
    cached.forEach(x => { if (x.crm_paid_invoices != null) paidBySale.set(x.id, Number(x.crm_paid_invoices)); });
    if (due.length) {
      const tokP = await ctx.bq.getAccessToken();
      const minSold = due.map(x => String(x.sold_date || '').slice(0, 10)).filter(Boolean).sort()[0] || '2026-01-01';
      for (let i = 0; i < due.length; i += 2000) {
        const part = due.slice(i, i + 2000);
        const r = await runQuery(tokP, ticketsForSubsSql(T, part.map(x => x.crm_subscription_id), minSold));
        const bySubT = new Map();
        for (const t of ((r && r.objects) || [])) { const k = String(t.sub_id); (bySubT.get(k) || bySubT.set(k, []).get(k)).push(t); }
        for (const x of part) {
          const n = paidCountFrom(bySubT.get(String(x.crm_subscription_id)) || [], x.sold_date);
          paidBySale.set(x.id, n);
          await write(x.id, { crm_paid_invoices: n, crm_paid_invoices_at: stamp }, 'paid-invoices');
        }
      }
      log.info('paid invoices counted for ' + due.length + ' Inside Sales sale(s)');
    }
  } catch (pe) { log.warn('paid-invoice count skipped (run migrations/20261014c_sales_paid_invoices.sql?): ' + String((pe && pe.message) || pe).slice(0, 200)); }

  // ── 💳 Paid since the sale (per Isaac, Oct 15) — see paidSinceDecision.
  await ctx.stage('paid-since-sale');
  const paidSince = new Map();   // sale id → { paid, paidAt, declinedAt }
  const nsfNow = new Set();      // set to NSF this run — the approval pass below must not overwrite it
  try {
    const _from = (/^\d{4}-\d{2}-\d{2}$/.test(String(AL2.auto_approve_from || '')) ? String(AL2.auto_approve_from) : '2026-10-12');
    const { data: pc, error: pe } = await selectAll(() => supabase.from('sales')
      .select('id, customer_number, sold_date, audit_status, notes, queue_type, sale_kind, rep_id, payroll_processed_at, crm_paid_since_sale, crm_payment_checked_at')
      .gte('sold_date', _from).is('payroll_processed_at', null).in('audit_status', ['pending', 'nsf', 'serviced', 'below_minimums']));
    if (pe) throw new Error(pe.message);
    const RECHECK = 20 * 60000;   // unpaid-yet sales re-checked every 20 min (was 3h — per Isaac, Oct 15: as fast as we can)
    // Declined / NSF rows are re-checked every run so they flip back as soon as the customer pays.
    const due = (pc || []).filter(x => x.customer_number && x.crm_paid_since_sale !== true
      && (x.audit_status === 'nsf' || x.crm_paid_since_sale === false || !x.crm_payment_checked_at || (today - Date.parse(x.crm_payment_checked_at)) > RECHECK));
    if (due.length) {
      const tokPay = await ctx.bq.getAccessToken();
      const TP = T('FieldRoutesPayment');
      const cids = [...new Set(due.map(x => String(x.customer_number).replace(/[^0-9]/g, '')).filter(Boolean))];
      const minSold = due.map(x => String(x.sold_date || '').slice(0, 10)).sort()[0];
      const byCust = new Map();
      for (let i = 0; i < cids.length; i += 1000) {
        const part = cids.slice(i, i + 1000);
        // Inlined id list (digits only, sanitised above) — named params are scalars only.
        const r = await runQuery(tokPay, `
SELECT fieldRoutes_customerID AS cid, LEFT(fieldRoutes_date, 10) AS d, fieldRoutes_status AS st, fieldRoutes_paymentMethod AS pm,
       SAFE_CAST(fieldRoutes_amount AS FLOAT64) AS amt, fieldRoutes_writeOff AS wo, fieldRoutes_creditMemo AS cm
FROM ${TP}
WHERE fieldRoutes_customerID IN (${part.map(c => "'" + c + "'").join(',')}) AND LEFT(fieldRoutes_date, 10) >= '${minSold}'
QUALIFY ROW_NUMBER() OVER (PARTITION BY fieldRoutes_paymentID ORDER BY updatedAt DESC) = 1`);
        for (const t of ((r && r.objects) || [])) { const k = String(t.cid); (byCust.get(k) || byCust.set(k, []).get(k)).push(t); }
      }
      for (const x of due) {
        const { v, upd } = paidSinceDecision(x, byCust, { stamp, _autoApproveOn, nsfNow });
        paidSince.set(x.id, v);
        const ue = await write(x.id, upd, 'paid-since-sale');
        if (ue) throw new Error(ue.message);
        if (upd.audit_status) stageCount++;
      }
      log.info('paid-since-sale checked for ' + due.length + ' sale(s)');
    }
    (pc || []).forEach(x => { if (x.crm_paid_since_sale === true && !paidSince.has(x.id)) paidSince.set(x.id, { paid: true }); });
  } catch (pe) { log.warn('paid-since-sale skipped (run migrations/20261015d_sales_paid_since_sale.sql?): ' + String((pe && pe.message) || pe).slice(0, 200)); }

  // ── Pricing minimums + the one-time current-customer check.
  await ctx.stage('minimums');
  const priorDone = new Set();
  const { PR, belowMinReason, oneTimeMin } = makePricing(AL2, priorDone);
  const belowMin = new Map();   // sale id → reason ('' = at/above minimum)
  try {
    const cand = (crmSales || []).filter(x => x.audit_status === 'pending' && !x.payroll_processed_at).map(x => ({ x, r: bySub.get(String(x.crm_subscription_id)) }))
      .filter(({ r }) => r && /^one[\s-]*time\b/i.test(String(r.subscription || '')) && oneTimeMin(r.subscription) && Number(r.initial_price) < oneTimeMin(r.subscription).nw - 0.001);
    if (cand.length) {
      const tokO = await ctx.bq.getAccessToken();
      const pairs = cand.map(({ x, r }) => "STRUCT('" + String(r.customer_id).replace(/[^0-9]/g, '') + "' AS cid, '" + String(x.sold_date || '').slice(0, 10).replace(/[^0-9-]/g, '') + "' AS sold)");
      const r2 = await runQuery(tokO, `
WITH c AS (SELECT * FROM UNNEST([${pairs.join(',')}]))
SELECT DISTINCT c.cid FROM c JOIN ${T('FieldRoutesAppointment')} a ON a.fieldRoutes_customerID = c.cid
WHERE a.fieldRoutes_statusText = 'Completed' AND a.fieldRoutes_dateCompleted NOT LIKE '0000%' AND a.fieldRoutes_dateCompleted != ''
  AND LEFT(a.fieldRoutes_dateCompleted, 10) < c.sold`);
      ((r2 && r2.objects) || []).forEach(o => priorDone.add(String(o.cid)));
    }
  } catch (oe) { log.warn('one-time prior-service check skipped: ' + String((oe && oe.message) || oe).slice(0, 200)); }

  // ── The approve / cancel / lock pass.
  await ctx.stage('stage');
  const d = { AL2, PR, today, stamp, paidSince, nsfNow, belowMin, paidBySale, OFFICE_PAID_N, lockDays: S.lockDays, minSvc: S.minSvc, _autoApproveOn, _upfrontOf: S._upfrontOf, belowMinReason };
  for (const s of (crmSales || [])) {
    const r = bySub.get(String(s.crm_subscription_id));
    if (!r) continue;                                     // not in this snapshot — leave it alone
    const upd = decideStage(s, r, d);
    if (!Object.keys(upd).length) continue;
    const uErr = await write(s.id, upd, 'stage');
    if (uErr) { log.warn('auto-stage failed for sale ' + s.id + ': ' + uErr.message); continue; }
    stageCount++;
  }

  // Add-on sales already paid upfront: the plan they ride on cancelled → Chargeback (per Isaac, Oct 15 —
  // non-commissionable for any reason). They stay on Pending Backend Lock until the quarterly backend run.
  try {
    const { data: upsP } = await selectAll(() => supabase.from('sales').select('id, parent_subscription_id, lock_status')
      .eq('sale_kind', 'upsell').not('payroll_processed_at', 'is', null).is('backend_payroll_processed_at', null)
      .not('parent_subscription_id', 'is', null).or('lock_status.is.null,lock_status.eq.pending'));
    for (const u of (upsP || [])) {
      const r = bySub.get(String(u.parent_subscription_id));
      if (!r || !(r.subscription_date_canceled || /cancel|inactive/i.test(String(r.subscription_status || '')))) continue;
      const ue = await write(u.id, { lock_status: 'chargeback', audit_2_at: stamp }, 'addon-chargeback');
      if (!ue) stageCount++;
    }
  } catch (ue) { log.warn('add-on chargeback check skipped: ' + String((ue && ue.message) || ue).slice(0, 200)); }
  if (stageCount) log.info('auto-stage: ' + stageCount + ' sale(s) moved');

  // Stamp the Below Minimums reason on the row (shown on the Sales tab) — only when it changed.
  let bmStamped = 0;
  if (belowMin.size) {
    try {
      const ids = [...belowMin.keys()], cur = new Map();
      for (let i = 0; i < ids.length; i += 500) {
        const { data: bmRows, error: be } = await supabase.from('sales').select('id, crm_below_min').in('id', ids.slice(i, i + 500));
        if (be) throw new Error(be.message);
        (bmRows || []).forEach(x => cur.set(x.id, x.crm_below_min || null));
      }
      for (const [id, why] of belowMin) {
        const v = why || null;
        if (cur.get(id) === v) continue;
        const ue = await write(id, { crm_below_min: v }, 'below-min-reason');
        if (ue) throw new Error(ue.message);
        bmStamped++;
      }
      if (bmStamped) log.info('below-minimum reasons updated on ' + bmStamped + ' sale(s)');
    } catch (be) { log.warn('below-minimum stamp skipped (run migrations/20261015e_sales_below_min.sql?): ' + String((be && be.message) || be).slice(0, 200)); }
  }

  // The summary: what moved, by kind. A dry run also lists the first rows so it can be read off the HTTP answer.
  const byKind = {};
  for (const p of plan) { const k = p.why + (p.audit_status ? ':' + p.audit_status : p.lock_status ? ':lock_' + p.lock_status : ''); byKind[k] = (byKind[k] || 0) + 1; }
  const summary = { snapshot: snap.uploadedAt, snapshotRows: objects.length, openSales: (crmSales || []).length, moved: stageCount, belowMinStamped: bmStamped, byKind, dataAsOf: snap.uploadedAt };
  if (dryRun) {
    summary.sample = plan.filter(p => p.audit_status || p.lock_status).slice(0, 40).map(p => ({ id: p.id, why: p.why, audit_status: p.audit_status, lock_status: p.lock_status }));
    await ctx.publish('sync/staging-plan.json', Buffer.from(JSON.stringify({ summary, plan }, null, 1)));
  }
  return summary;
});
