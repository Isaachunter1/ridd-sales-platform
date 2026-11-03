// ┌─ indicators/functions/publishTables.js ─────────────────────────────────
// │ The derived dataset as tables, written the cheap way.
// │
// │ Was (netlify derive worker): every 5 minutes insert a full copy of
// │ indicator_sales (~96k rows) then DELETE every older copy through
// │ PostgREST — and the delete timed out, so copies stacked up (19 of them,
// │ 6 GB, Nov 3 2026) while the delete attempted more rows each run; plus
// │ an UPSERT of all ~109k crm_subscriptions rows, each one a new row
// │ version even when nothing changed. That churn is what kept the database
// │ in swap.
// │
// │ Now:
// │  · indicator_sales / indicator_weekly — insert this run, then prune
// │    through public.indicator_tables_prune() (db/migrations/20261103_
// │    indicator_tables_prune.sql): one old run per statement, server-side,
// │    with its own statement timeout, so a prune can never be cut short by
// │    a client. A failed prune FAILS the job (Slack says so) instead of
// │    being logged and forgotten.
// │  · crm_subscriptions — diff by row hash: fetch {subscription_id → hash}
// │    in one call, upsert only rows whose hash changed or that are new,
// │    delete only ids that left the snapshot. A quiet run touches a few
// │    hundred rows, not 109k.
// └─────────────────────────────────────────────────────────────────────────
import { createHash } from 'node:crypto';

// The exact crm_subscriptions column set the Netlify worker mirrored (order matters for the hash).
export const CRM_FIELDS = ['subscription_id','customer_id','sold_date','sold_at','sold_by_id','sold_by','sold_by_type','subscription',
  'subscription_status','initial_status','initial_service','initial_serviced_date','subscription_completed_services',
  'subscription_cancellation_reason','subscription_date_canceled','subscription_source','lead_source','recurring_frequency',
  'agreement_length','annual_recurring_value','subscription_contract_value','initial_price','customer_auto_pay','customer_flags',
  'customer_missing','contract_state','contract_signed_at','county','state','zip_code','office_name','days_past_due',
  'responsible_balance','first_name','last_name','phone','email'];

// One snapshot object → the mirror row, exactly as before (blank → null, ids as strings).
export function crmRow(o) {
  const r = {};
  for (const k of CRM_FIELDS) { const v = o[k]; r[k] = (v === undefined || v === '') ? null : v; }
  r.subscription_id = String(o.subscription_id);
  if (r.customer_id != null) r.customer_id = String(r.customer_id);
  if (r.sold_by_id != null) r.sold_by_id = String(r.sold_by_id);
  r.customer_missing = !!r.customer_missing;
  return r;
}

// Stable content hash of a mirror row (every mirrored column, in CRM_FIELDS order).
export function rowHash(r) {
  const h = createHash('sha1');
  for (const k of CRM_FIELDS) { const v = r[k]; h.update(v == null ? '\u0000' : String(v)); h.update('\u0001'); }
  return h.digest('hex').slice(0, 20);
}

// Pure diff: snapshot objects + {id → hash} of what's in the table → what to write.
export function diffCrm(objects, existing) {
  const seen = new Set(); const upserts = [];
  for (const o of objects || []) {
    const sid = o.subscription_id == null ? '' : String(o.subscription_id);
    if (!sid || seen.has(sid)) continue;
    seen.add(sid);
    const r = crmRow(o); r.row_hash = rowHash(r);
    if (existing.get(sid) !== r.row_hash) upserts.push(r);
  }
  const deletes = []; for (const id of existing.keys()) if (!seen.has(id)) deletes.push(id);
  return { upserts, deletes, total: seen.size };
}

// indicator_sales row from a derived rawSales row — as before.
export const salesRow = (r, computedAt) => ({ computed_at: computedAt, office: r.office || null, subscription: r.subscription || null, active: r.active || null,
  cancel_reason: r.cancelReason || null, cancel_date: r.cancelDate || null, rep: r.rep || null, rep_id: r.repId || null,
  rep_type: r.repType || null, week: r.week == null ? null : Number(r.week) || null, date_sold: r.dateSold || null,
  status: r.status || null, auto_pay: r.autoPay == null ? null : String(r.autoPay), customer_flags: r.customerFlags || null,
  serviced_date: r.servicedDate || null, initial_status: r.initialStatus || null, age: Number(r.age) || 0,
  source: r.source || null, contract: r.contract == null ? null : String(r.contract),
  initial_price: Number(r.initialPrice) || 0, contract_value: Number(r.contractValue) || 0,
  recurring: Number(r.recurring) || 0, services: Number(r.services) || 0 });

export const weeklyRow = (w, computedAt) => ({ computed_at: computedAt, week: Number(w.week) || null, date_label: w.date || null, iso_start: w.iso_start || null,
  branch: w.branch || null, sold_accounts: Number(w.sold_accounts) || 0, revenue: Number(w.revenue) || 0,
  avg_initial: Number(w.avg_initial) || 0, avg_initial_count: Number(w.avg_initial_count) || 0,
  auto_pay_pct: Number(w.auto_pay_pct) || 0, audit_fail: Number(w.audit_fail) || 0, last_resort: Number(w.last_resort) || 0,
  multi_years: Number(w.multi_years) || 0, twelve_month: Number(w.twelve_month) || 0, reps: Number(w.reps) || 0 });

async function insertBatches(supabase, table, rows, size = 1000) {
  for (let i = 0; i < rows.length; i += size) {
    const { error } = await supabase.from(table).insert(rows.slice(i, i + size));
    if (error) throw new Error(table + ' insert: ' + error.message);
  }
  return rows.length;
}

// indicator_sales + indicator_weekly for this run, then prune every older run server-side.
export async function publishIndicatorTables({ supabase, payload, computedAt, log }) {
  const sales = await insertBatches(supabase, 'indicator_sales', payload.rawSales.map(r => salesRow(r, computedAt)));
  const weekly = await insertBatches(supabase, 'indicator_weekly', payload.indicatorsData.map(w => weeklyRow(w, computedAt)));
  // Prune in the database: one older computed_at per statement until none remain. Each
  // call is bounded (one run's rows) and runs under the function's own statement timeout.
  let pruned = 0, passes = 0;
  for (;;) {
    const { data, error } = await supabase.rpc('indicator_tables_prune', { p_keep: computedAt });
    if (error) throw new Error('indicator_tables_prune: ' + error.message + ' (run db/migrations/20261103_indicator_tables_prune.sql?)');
    const n = Number(data) || 0; passes++;
    if (!n) break;
    pruned += n;
    if (passes > 200) throw new Error('indicator_tables_prune: still pruning after 200 passes — stacked runs?');
  }
  log.info('indicator tables', { sales, weekly, pruned, passes });
  return { sales, weekly, pruned };
}

// crm_subscriptions mirror, diff-based.
export async function publishCrmMirror({ supabase, objects, syncedAt, log }) {
  const { data, error } = await supabase.rpc('crm_subscriptions_hashes');
  if (error) throw new Error('crm_subscriptions_hashes: ' + error.message + ' (run db/migrations/20261103_indicator_tables_prune.sql?)');
  const existing = new Map();
  for (const line of String(data || '').split('\n')) { if (!line) continue; const i = line.indexOf('\t'); if (i > 0) existing.set(line.slice(0, i), line.slice(i + 1)); }
  const { upserts, deletes, total } = diffCrm(objects, existing);
  for (let i = 0; i < upserts.length; i += 1000) {
    const chunk = upserts.slice(i, i + 1000).map(r => ({ ...r, synced_at: syncedAt }));
    const { error: e } = await supabase.from('crm_subscriptions').upsert(chunk, { onConflict: 'subscription_id' });
    if (e) throw new Error('crm_subscriptions upsert: ' + e.message);
  }
  for (let i = 0; i < deletes.length; i += 500) {
    const { error: e } = await supabase.from('crm_subscriptions').delete().in('subscription_id', deletes.slice(i, i + 500));
    if (e) throw new Error('crm_subscriptions delete: ' + e.message);
  }
  log.info('crm_subscriptions mirror', { total, changed: upserts.length, removed: deletes.length, unchanged: total - upserts.length });
  return { total, changed: upserts.length, removed: deletes.length };
}
