// ┌─ rep-eod ────────────────────────────────────────────────────────────────
// │ End-of-day DM to every Inside Sales / Loyalty rep with a Slack ID (per
// │ Isaac, Nov 18): revenue, subscriptions, pace for the day / week / month /
// │ year, ACV vs $700, multi-year % vs 60%, and Plaibook's close rate — the
// │ same numbers their Revenue Pacer and the TV board show. Optional team
// │ roll-up to a channel webhook.
// │
// │ Runs hourly; sends once per work day when the Mountain hour reaches
// │ app_settings.pay_settings.eod_report.send_hour (default 18). The state
// │ row app_settings.eod_report_state remembers the last day sent, so a
// │ redeploy or a second kick never double-DMs. An admin kick with
// │ ?force=1 (the Settings "Send now" button) sends regardless of the hour;
// │ ?preview=<profile id> DMs only that person (the "Send me a preview").
// │
// │ Reads: reporting/indicators/latest.json.gz (rawSales), profiles,
// │ fieldroutes_employees (branch ids → one rep), reporting_source_config
// │ (which sources are renewals), app_settings close_rates_tv + pay_settings.
// │ Sends with SLACK_BOT_TOKEN (chat:write + im:write) to profiles.slack_member_id,
// │ falling back to the admin-entered slack_user_id. Respects slack_notify = false
// │ and the per-type switch pay_settings.slack_types.office.
// └─────────────────────────────────────────────────────────────────────────
import zlib from 'node:zlib';
import { job } from '../../../runtime/job.js';
import { localParts, BOARD_TZ } from '../../pay/functions/tvWindows.js';
import { EOD_DEFAULTS, buildRepEod, renderEodBlocks, renderTeamBlocks, isWorkDay, eodWindows } from '../functions/eodReport.js';

const OFFICE_ROLES = new Set(['rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead', 'office_staff']);

async function slackPost(token, body) {
  const r = await fetch('https://slack.com/api/chat.postMessage', { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + token }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!j.ok) throw new Error('Slack: ' + (j.error || ('HTTP ' + r.status)));
  return j;
}

export async function loadEodInputs(supabase) {
  const [{ data: profs }, { data: roster }, { data: srcCfg }, { data: settings }] = await Promise.all([
    supabase.from('profiles').select('id, full_name, role, is_active, fieldroutes_employee_id, annual_revenue_goal, year_goals, slack_member_id, slack_user_id, slack_notify'),
    supabase.from('fieldroutes_employees').select('employee_id, employee_ids, fname, lname, type_label'),
    supabase.from('reporting_source_config').select('source, revenue_class'),
    supabase.from('app_settings').select('key, value').in('key', ['pay_settings', 'close_rates_tv', 'eod_report_state']),
  ]);
  const byKey = Object.fromEntries((settings || []).map(r => [r.key, r.value || {}]));
  const pay = byKey.pay_settings || {};
  const cfg = Object.assign({}, EOD_DEFAULTS, pay.eod_report || {});
  const slackTypes = Object.assign({ office: true }, pay.slack_types || {});
  const renewalSources = new Set((srcCfg || []).filter(r => r && r.revenue_class === 'renewal').map(r => String(r.source).trim()));
  const { data: blob, error } = await supabase.storage.from('reporting').download('indicators/latest.json.gz');
  if (error) throw new Error('indicators/latest.json.gz: ' + error.message);
  const payload = JSON.parse(zlib.gunzipSync(Buffer.from(await blob.arrayBuffer())).toString('utf8'));
  const rawSales = Array.isArray(payload.rawSales) ? payload.rawSales : [];
  const rosterByMaster = new Map((roster || []).map(e => [String(e.employee_id), e]));
  const rosterByAny = new Map(); for (const e of roster || []) for (const x of String(e.employee_ids || e.employee_id || '').split(',')) if (x.trim()) rosterByAny.set(x.trim(), e);
  const rosterFor = (p) => { const id = String(p.fieldroutes_employee_id || '').trim(); return (id && (rosterByMaster.get(id) || rosterByAny.get(id))) || null; };
  return { profiles: profs || [], rosterFor, renewalSources, rawSales, uploadedAt: payload.uploadedAt || null, closeTv: byKey.close_rates_tv || null, cfg, slackTypes, state: byKey.eod_report_state || {} };
}

export default job('rep-eod', {
  schedule: '3 * * * *',   // hourly; the send hour is a setting, so the gate lives in the job (DECISIONS 2026-10-20: wall-clock gates stay inside the job)
  description: 'End-of-day Slack DM to each Inside Sales / Loyalty rep: revenue, subs, pace, ACV, multi-year %, close rate',
  heartbeat: 'indicators/rep-eod-heartbeat.json',
  onFail: 'Reps did not get tonight’s end-of-day DM; the numbers are still on their Revenue Pacer.',
}, async (ctx) => {
  const { supabase, now } = ctx;
  const opt = ctx.params || {};
  const force = String(opt.force || '') === '1', preview = String(opt.preview || '').trim();
  const { profiles, rosterFor, renewalSources, rawSales, uploadedAt, closeTv, cfg, slackTypes, state } = await loadEodInputs(supabase);
  const { y, m, d } = localParts(now, BOARD_TZ);
  const todayIso = eodWindows(now).today.end;
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: BOARD_TZ, hour: 'numeric', hour12: false, hourCycle: 'h23' }).format(now));

  if (!preview && !force) {
    if (!cfg.enabled) return { skipped: 'end-of-day report is off (Settings → Notifications)' };
    if (!isWorkDay(todayIso)) return { skipped: 'not a work day (' + todayIso + ')' };
    if (hour < Number(cfg.send_hour)) return { skipped: 'before send hour (' + hour + ' < ' + cfg.send_hour + ' Mountain)' };
    if (state.last_sent_day === todayIso) return { skipped: 'already sent for ' + todayIso };
  }
  if (!ctx.env.SLACK_BOT_TOKEN) return { skipped: 'SLACK_BOT_TOKEN not set on the server — nothing sent', configured: false };
  if (slackTypes.office === false && !preview) return { skipped: 'Slack is off for office reps (Settings → Configurations)' };

  // Who gets one: active office-staff roles with a Slack ID who have not opted out — or just the preview target.
  const sid = (p) => (p.slack_member_id || p.slack_user_id || '').trim();
  let targets = profiles.filter(p => p.is_active !== false && OFFICE_ROLES.has(String(p.role)) && sid(p) && p.slack_notify !== false);
  if (preview) targets = profiles.filter(p => p.id === preview);
  if (!targets.length) return { skipped: preview ? 'preview target has no Slack ID' : 'no office reps with a Slack ID', uploadedAt };

  await ctx.stage('building');
  const built = targets.map(p => ({ p, m: buildRepEod({ prof: p, rosterRow: rosterFor(p), rawSales, closeTv, renewalSources, now, cfg }) }));

  await ctx.stage('sending');
  let sent = 0, failed = 0; const errors = [];
  for (const { p, m } of built) {
    const to = sid(p); if (!to) { failed++; errors.push(p.full_name + ': no Slack ID'); continue; }
    const msg = renderEodBlocks(m, cfg);
    if (ctx.dryRun) { ctx.log.info('dry run: would DM ' + p.full_name, { text: msg.text }); sent++; continue; }
    try { await slackPost(ctx.env.SLACK_BOT_TOKEN, { channel: to, text: msg.text, blocks: msg.blocks }); sent++; }
    catch (e) { failed++; errors.push(p.full_name + ': ' + (e && e.message)); ctx.log.warn('DM failed for ' + p.full_name + ': ' + (e && e.message)); }
  }
  // Team roll-up to a channel, when one is configured (never for a single-person preview).
  let channel = false;
  if (!preview && cfg.channel_webhook && !ctx.dryRun) {
    try { const t = renderTeamBlocks(built.map(b => b.m), todayIso); const r = await fetch(cfg.channel_webhook, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(t) }); channel = r.ok; }
    catch (e) { ctx.log.warn('channel roll-up failed: ' + (e && e.message)); }
  }
  if (!preview && !ctx.dryRun) {
    const { error } = await supabase.from('app_settings').upsert({ key: 'eod_report_state', value: { last_sent_day: todayIso, sent_at: now.toISOString(), sent, failed, errors: errors.slice(0, 20) } }, { onConflict: 'key' });
    if (error) ctx.log.warn('eod_report_state write failed: ' + error.message);
  }
  if (ctx.dryRun) await ctx.publish('slack/rep-eod-sample.json', Buffer.from(JSON.stringify(built.map(b => ({ name: b.p.full_name, metrics: b.m, slack: renderEodBlocks(b.m, cfg) })), null, 1)));
  return { day: todayIso, reps: targets.length, sent, failed, channel, dataAsOf: uploadedAt, preview: preview || undefined, errors: errors.length ? errors.slice(0, 5) : undefined };
});
