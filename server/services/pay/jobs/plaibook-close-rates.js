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
// │
// │ TV Display (per Isaac, Nov 11): the board's close rate follows the board's
// │ own date range, and tapping it drills into Plaibook's three lists for THAT
// │ range. So the same pull runs once per TV range (today … this year, on the
// │ board's Mountain calendar — functions/tvWindows.js) and lands in a second
// │ key, app_settings.close_rates_tv, which only the board reads; the pay
// │ window above stays in close_rates, untouched. Lists are capped per column
// │ (the count is kept) so the year window stays a sane row size.
// └─────────────────────────────────────────────────────────────────────────
import { job } from '../../../runtime/job.js';
import { PlaibookMcp, parseSalesKpis, parseRecords, recordCount } from '../functions/plaibookMcp.js';
import { tvWindows, localParts, BOARD_TZ } from '../functions/tvWindows.js';

const LIST_CAP = 250;   // rows kept per drill column per rep per window; the header shows "first 250 of N"

const iso = (d) => d.toISOString().slice(0, 10);
const digits = (p) => String(p || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');

export default job('plaibook-close-rates', {
  schedule: '17 * * * *',   // hourly — Plaibook's own close rate refreshes about hourly (per Isaac)
  description: 'Close rates + drill lists from Plaibook → app_settings.close_rates (pay stub, bonus tier, TV leaderboard)',
  timeoutMinutes: 25,   // 7 TV ranges × reps × 3 lists on top of the pay window (Nov 11)
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

  // One rep's three drill lists for a window: Closed · Qualified, not closed · Unqualified (Plaibook's own outcomes).
  const listsFor = async (r, win, cap) => {
    const row = { name: r.name, rate: r.rate, sold: r.sold, qualified: r.qualified, revenue: r.revenue || 0 };
    const pull = async (outcome, kind) => {
      try {
        const p = await mcp.call('query_opportunities', { content: 'RIDD Sales Platform: ' + kind.replace(/_/g, ' ') + ' for ' + r.name + ' · ' + win.label, show: 'records', rep: r.name, outcome, sort: 'newest', startDate: win.start, endDate: win.end });
        const rows = parseRecords(p, kind, planOf);
        row[kind] = cap ? rows.slice(0, cap) : rows;
        row[kind + '_n'] = Math.max(recordCount(p), rows.length);
      } catch (e) { ctx.log.warn(r.name + ' ' + kind + ' (' + win.label + ') list skipped: ' + (e && e.message)); }
    };
    await pull('sold', 'closed');
    await pull('qualifiedNotSold', 'qualified_not_closed');
    await pull('unqualified', 'unqualified');
    return row;
  };

  await ctx.stage('lists');
  const out = {};
  for (const r of reps) out[r.name.trim().toLowerCase()] = await listsFor(r, window, 0);
  const next = { source: 'plaibook', window, pulled_at: ctx.now.toISOString(), aliases: prev.aliases || {}, reps: out };

  // The TV's ranges, each its own block: rates + capped lists. A rep with a seat but nothing in the range still gets a row (0 / 0).
  await ctx.stage('tv');
  const seats = reps.map(r => r.name);
  const tv = { source: 'plaibook', tz: BOARD_TZ, pulled_at: ctx.now.toISOString(), aliases: prev.aliases || {}, seats, windows: {} };
  let tvLists = 0;
  for (const win of tvWindows(ctx.now)) {
    const block = { id: win.id, start: win.start, end: win.end, label: win.label, reps: {} };
    try {
      const k = await mcp.call('query_sales_kpis', { content: 'RIDD Sales Platform: close rate by rep · ' + win.label, groupBy: 'agent', startDate: win.start, endDate: win.end });
      const rows = parseSalesKpis(k);
      for (const name of seats) {
        const r = rows.find(x => x.name.trim().toLowerCase() === name.trim().toLowerCase());
        const key = name.trim().toLowerCase();
        if (!r) { block.reps[key] = { name, rate: null, sold: 0, qualified: 0, revenue: 0, closed: [], qualified_not_closed: [], unqualified: [], closed_n: 0, qualified_not_closed_n: 0, unqualified_n: 0 }; continue; }
        block.reps[key] = await listsFor(r, win, LIST_CAP);
        tvLists += 3;
      }
    } catch (e) { ctx.log.warn('TV window ' + win.label + ' skipped: ' + (e && e.message)); block.error = String(e && e.message || e).slice(0, 200); }
    tv.windows[win.id] = block;
  }

  // Department close rate by month (per Isaac, Nov 11 — the Marketing → Metrics tile): Plaibook's team-level
  // sold ÷ qualified for each of the last 13 calendar months (board calendar), one call per month, tiny row.
  await ctx.stage('months');
  const dept = { source: 'plaibook', tz: BOARD_TZ, pulled_at: ctx.now.toISOString(), months: {} };
  const { y: ly, m: lm } = localParts(ctx.now);
  for (let i = 12; i >= 0; i--) {
    const d = new Date(Date.UTC(ly, lm - i, 1)); const y = d.getUTCFullYear(), m = d.getUTCMonth();
    const ym = y + '-' + String(m + 1).padStart(2, '0');
    const start = ym + '-01', end = y + '-' + String(m + 1).padStart(2, '0') + '-' + String(new Date(Date.UTC(y, m + 1, 0)).getUTCDate()).padStart(2, '0');
    try {
      const k = await mcp.call('query_sales_kpis', { content: 'RIDD Sales Platform: department close rate · ' + ym, startDate: start, endDate: end });
      const row = parseSalesKpis(k).find(x => /^team$/i.test(x.name)) || parseSalesKpis(k)[0] || null;
      if (row) dept.months[ym] = { rate: row.rate, sold: row.sold, qualified: row.qualified, opportunities: row.opportunities || null, revenue: row.revenue || null, start, end };
    } catch (e) { ctx.log.warn('dept close rate ' + ym + ' skipped: ' + (e && e.message)); }
  }

  if (ctx.dryRun) {
    await ctx.publish('pay/plaibook-close-rates-dept.json', Buffer.from(JSON.stringify(dept, null, 1)));
    await ctx.publish('pay/plaibook-close-rates.json', Buffer.from(JSON.stringify(next, null, 1)));
    await ctx.publish('pay/plaibook-close-rates-tv.json', Buffer.from(JSON.stringify(tv, null, 1)));
    return { reps: reps.length, window: window.label, tvWindows: Object.keys(tv.windows).length };
  }
  await ctx.stage('writing');
  const { error } = await supabase.from('app_settings').upsert({ key: 'close_rates', value: next }, { onConflict: 'key' });
  if (error) throw new Error('app_settings.close_rates write failed: ' + error.message);
  const { error: e2 } = await supabase.from('app_settings').upsert({ key: 'close_rates_tv', value: tv }, { onConflict: 'key' });
  if (e2) throw new Error('app_settings.close_rates_tv write failed: ' + e2.message);
  const { error: e3 } = await supabase.from('app_settings').upsert({ key: 'close_rates_dept', value: dept }, { onConflict: 'key' });
  if (e3) throw new Error('app_settings.close_rates_dept write failed: ' + e3.message);
  return { reps: reps.length, window: window.label, tvWindows: Object.keys(tv.windows).length, deptMonths: Object.keys(dept.months).length, lists: Object.values(out).reduce((a, r) => a + ((r.closed || []).length + (r.qualified_not_closed || []).length + (r.unqualified || []).length), 0) + tvLists };
});
