// ┌─ plaibook-close-rates ───────────────────────────────────────────────────
// │ Close rates from Plaibook, hourly (per Isaac, Nov 7): each Inside Sales
// │ rep's close rate as Plaibook's Sales team page shows it (sold ÷ qualified),
// │ plus the three lists behind it for the TV drill — Closed · Qualified, not
// │ closed · Unqualified — written to app_settings.close_rates, which the pay
// │ stub, the close-rate bonus and the TV leaderboard read (app/src/pay/
// │ close-rates.js). A rep with no Plaibook seat gets no row: No Close Rate.
// │
// │ Window: app_settings.close_rates.window.mode — '90d' (default, trailing
// │ 90 days) or 'quarter' (the current quarter to date, the backend run's
// │ window). Closed rows carry the FieldRoutes plan when the lead's phone
// │ matches a subscription in the crm_subscriptions mirror.
// │ Needs PLAIBOOK_MCP_URL + PLAIBOOK_MCP_TOKEN; without them the job logs
// │ "not configured" and leaves the last rows in place.
// └─────────────────────────────────────────────────────────────────────────
import { job } from '../../../runtime/job.js';
import { PlaibookMcp, parseSalesKpis, parseRecords, recordCount } from '../functions/plaibookMcp.js';

const iso = (d) => d.toISOString().slice(0, 10);
const digits = (p) => String(p || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

export default job('plaibook-close-rates', {
  schedule: '17 * * * *',   // hourly — Plaibook's own close rate refreshes about hourly (per Isaac)
  description: 'Close rates + drill lists from Plaibook → app_settings.close_rates (pay stub, bonus tier, TV leaderboard)',
  timeoutMinutes: 10,
  onFail: 'The stub and TV keep the last close rates saved; nothing is paid on a stale rate until this recovers.',
}, async (ctx) => {
  const { supabase } = ctx;
  if (!ctx.env.PLAIBOOK_MCP_URL || !ctx.env.PLAIBOOK_MCP_TOKEN) { ctx.log.warn('Plaibook not configured (PLAIBOOK_MCP_URL / PLAIBOOK_MCP_TOKEN) — nothing pulled'); return { configured: false }; }
  const { data: cur } = await supabase.from('app_settings').select('value').eq('key', 'close_rates').maybeSingle();
  const prev = (cur && cur.value) || {};
  const mode = String((prev.window && prev.window.mode) || '90d');
  const end = new Date(ctx.now);
  const start = mode === 'quarter' ? new Date(Date.UTC(end.getUTCFullYear(), Math.floor(end.getUTCMonth() / 3) * 3, 1)) : new Date(end.getTime() - 90 * 86400000);
  const window = { mode, start: iso(start), end: iso(end), label: (mode === 'quarter' ? 'Q' + (Math.floor(end.getUTCMonth() / 3) + 1) + ' to date' : 'last 90 days') + ' · ' + iso(start) + ' → ' + iso(end) };

  await ctx.stage('rates');
  const mcp = new PlaibookMcp({ url: ctx.env.PLAIBOOK_MCP_URL, token: ctx.env.PLAIBOOK_MCP_TOKEN });
  const kpis = await mcp.call('query_sales_kpis', { content: 'RIDD Sales Platform: close rate by rep', groupBy: 'agent', startDate: window.start, endDate: window.end });
  const reps = parseSalesKpis(kpis);
  if (!reps.length) throw new Error('Plaibook returned no per-rep close rates for ' + window.label);

  // FieldRoutes plan by customer phone (closed rows show the plan, not Plaibook's service line).
  await ctx.stage('plans');
  const planByPhone = new Map();
  try {
    const { data: subs } = await supabase.from('crm_subscriptions').select('phone, subscription, sold_date').gte('sold_date', window.start).not('phone', 'is', null).limit(20000);
    for (const s of (subs || [])) { const k = digits(s.phone); if (k && !planByPhone.has(k)) planByPhone.set(k, s.subscription); }
  } catch (e) { ctx.log.warn('crm_subscriptions plan lookup skipped: ' + (e && e.message)); }
  const planOf = (x) => planByPhone.get(digits(x.phone)) || null;

  await ctx.stage('lists');
  const out = {};
  for (const r of reps) {
    const row = { name: r.name, rate: r.rate, sold: r.sold, qualified: r.qualified, revenue: r.revenue || 0 };
    const pull = async (outcome, kind) => {
      try {
        const p = await mcp.call('query_opportunities', { content: 'RIDD Sales Platform: ' + kind.replace(/_/g, ' ') + ' for ' + r.name, show: 'records', rep: r.name, outcome, sort: 'newest', startDate: window.start, endDate: window.end });
        row[kind] = parseRecords(p, kind, planOf).filter(x => kind !== 'closed' || true);
        row[kind + '_n'] = recordCount(p);
      } catch (e) { ctx.log.warn(r.name + ' ' + kind + ' list skipped: ' + (e && e.message)); }
    };
    await pull('sold', 'closed');
    await pull('qualifiedNotSold', 'qualified_not_closed');
    await pull('unqualified', 'unqualified');
    out[r.name.trim().toLowerCase()] = row;
  }
  const next = { source: 'plaibook', window, pulled_at: ctx.now.toISOString(), aliases: prev.aliases || {}, reps: out };

  if (ctx.dryRun) { await ctx.publish('pay/plaibook-close-rates.json', Buffer.from(JSON.stringify(next, null, 1))); return { reps: reps.length, window: window.label }; }
  await ctx.stage('writing');
  const { error } = await supabase.from('app_settings').upsert({ key: 'close_rates', value: next }, { onConflict: 'key' });
  if (error) throw new Error('app_settings.close_rates write failed: ' + error.message);
  return { reps: reps.length, window: window.label, lists: Object.values(out).reduce((a, r) => a + ((r.closed || []).length + (r.qualified_not_closed || []).length + (r.unqualified || []).length), 0) };
});
