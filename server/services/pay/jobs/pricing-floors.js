// ┌─ pricing-floors ─────────────────────────────────────────────────────────
// │ Commission pricing floors + the signed-contract rule (per Isaac, Nov 7 2026).
// │ Runs after each RevHawk sync pass and scores every open sale sold on/after
// │ Configurations → Pricing minimums → "Pricing floors start" (default
// │ 2027-01-01 — commissions live on the Google Sheets until the clean switch):
// │
// │   under Standard  → Below Minimums (half upfront, full backend)
// │   under Loyalty   → Not Payable (nothing — until the price is fixed)
// │   no signed contract → Not Payable, back to Pending the moment it's signed
// │   anything the rules can't price (renewal under Loyalty, a plan or add-on
// │   with no sheet) → Flagged for Audit, with the reason on the row
// │   an add-on sold the SAME DAY as its base plan drags the base sale down
// │
// │ Writes public.sales (audit_status, status_set_by = 'pricing-floors', notes,
// │ crm_below_min = the reason, audit_flag = what an auditor should look at).
// │ It only ever reverses its OWN decisions; a status an admin or rep set by
// │ hand (status_set_by = 'manual') and the sync's own Below Minimums are left
// │ alone. The rules live in functions/pricingFloors.js (pure, tested).
// │
// │ Needs: db/migrations/20261107_pricing_floors.sql (status_set_by, audit_flag,
// │ payroll_skipped_at, the flagged_for_audit status).
// └─────────────────────────────────────────────────────────────────────────
import { job } from '../../../runtime/job.js';
import { sql, getAccessToken, queryObjects } from '../../../config/bigquery.js';
import { floorConfig, scoreSale, planUpdate } from '../functions/pricingFloors.js';

const PRICES_SQL = sql(import.meta.url, '../functions/fetchSubscriptionPrices');
const SCORED = ['pending', 'serviced', 'below_minimums', 'not_payable', 'flagged_for_audit'];
const COLS = 'id, customer_number, rep_id, queue_type, sale_kind, crm_subscription, crm_subscription_id, parent_subscription_id, contract_months, revenue_amount, sold_date, audit_status, status_set_by, notes, crm_below_min, audit_flag, audit_flag_by, crm_contract_state, crm_initial_status, payroll_processed_at, payroll_skipped_at';

async function selectAll(q) {
  const out = []; const page = 1000;
  for (let from = 0; ; from += page) {
    const { data, error } = await q().range(from, from + page - 1);
    if (error) throw new Error(error.message);
    out.push(...(data || []));
    if (!data || data.length < page) return out;
  }
}

export default job('pricing-floors', {
  schedule: '4-59/10 * * * *',   // every 10 min, just after the 5-min sync passes
  description: 'Commission pricing floors + signed-contract rule → sales.audit_status (Below Minimums / Not Payable / Flagged for Audit)',
  timeoutMinutes: 10,
  onFail: 'Sales keep the status the last pass gave them; nothing is paid on a sale this job has not scored.',
}, async (ctx) => {
  const { supabase } = ctx;
  const { data: alRow, error: alErr } = await supabase.from('app_settings').select('value').eq('key', 'autolog').maybeSingle();
  if (alErr) throw new Error('app_settings read failed: ' + alErr.message);
  const AL = (alRow && alRow.value) || {};
  const cfg = floorConfig(AL);
  cfg.today = ctx.now.toISOString().slice(0, 10);
  if (cfg.today < cfg.start) { ctx.log.info('pricing floors start ' + cfg.start + ' is in the future — nothing scored yet'); return { start: cfg.start, scored: 0 }; }

  await ctx.stage('reading sales');
  const sales = await selectAll(() => supabase.from('sales').select(COLS)
    .gte('sold_date', cfg.start).is('payroll_processed_at', null).in('audit_status', SCORED));
  if (!sales.length) return { start: cfg.start, scored: 0 };

  // Prices for the base plans from the warehouse (initial + recurring are not on the sale row; the row's
  // monthly_amount is a contract-value estimate, not the charge).
  await ctx.stage('reading prices');
  const subs = new Map();
  const baseIds = [...new Set(sales.filter(s => String(s.sale_kind || 'sale') !== 'upsell' && s.crm_subscription_id).map(s => String(s.crm_subscription_id).replace(/[^0-9]/g, '')).filter(Boolean))];
  if (baseIds.length) {
    const token = await getAccessToken();
    const since = sales.map(s => String(s.sold_date || '').slice(0, 10)).filter(Boolean).sort()[0] || cfg.start;
    for (let i = 0; i < baseIds.length; i += 2000) {
      const part = baseIds.slice(i, i + 2000).map(id => "'" + id + "'").join(',');
      const rows = await queryObjects(token, PRICES_SQL.replace('{{IDS}}', part), { since });
      for (const r of rows) subs.set(String(r.subscription_id), r);
    }
  }

  // Same-day add-ons per base sale (customer + sold date — the sold-together rule).
  const addonsByKey = new Map();
  for (const s of sales) {
    if (String(s.sale_kind || 'sale') !== 'upsell') continue;
    const k = String(s.customer_number || '') + '|' + String(s.sold_date || '').slice(0, 10);
    (addonsByKey.get(k) || addonsByKey.set(k, []).get(k)).push(s);
  }

  await ctx.stage('scoring');
  const stamp = ctx.now.toISOString();
  const counts = { scored: 0, not_payable: 0, below_minimums: 0, flagged_for_audit: 0, back_to_pending: 0, flagged_only: 0, unpriced: 0 };
  const writes = [];
  for (const s of sales) {
    const upsell = String(s.sale_kind || 'sale') === 'upsell';
    const sub = upsell ? null : subs.get(String(s.crm_subscription_id || '').replace(/[^0-9]/g, '')) || null;
    if (!upsell && !sub && s.crm_subscription_id) { counts.unpriced++; }   // not in the warehouse yet — the contract rule still runs
    const same = upsell ? [] : (addonsByKey.get(String(s.customer_number || '') + '|' + String(s.sold_date || '').slice(0, 10)) || []).filter(a => !a.parent_subscription_id || String(a.parent_subscription_id) === String(s.crm_subscription_id || ''));
    const score = scoreSale(Object.assign({}, s, { sub }), cfg, same);
    counts.scored++;
    const upd = planUpdate(s, score, stamp);
    if (!upd) continue;
    if (upd.audit_status === 'pending') counts.back_to_pending++;
    else if (upd.audit_status) counts[upd.audit_status] = (counts[upd.audit_status] || 0) + 1;
    else counts.flagged_only++;
    writes.push({ id: s.id, customer: s.customer_number, from: s.audit_status, upd });
  }

  if (ctx.dryRun) {
    await ctx.publish('pay/pricing-floors.json', Buffer.from(JSON.stringify({ computedAt: stamp, cfg: { start: cfg.start, initialMin: cfg.initialMin }, counts, writes }, null, 1)));
    return counts;
  }
  await ctx.stage('writing');
  for (const w of writes) {
    const { error } = await supabase.from('sales').update(w.upd).eq('id', w.id);
    if (error) throw new Error('sales update ' + w.id + ' failed: ' + error.message + (/status_set_by|audit_flag|payroll_skipped_at|flagged_for_audit/i.test(error.message) ? ' (run db/migrations/20261107_pricing_floors.sql?)' : ''));
  }
  return { ...counts, writes: writes.length, start: cfg.start };
});
