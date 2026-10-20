// Admin-channel Slack lines. One incoming webhook (SLACK_ADMIN_WEBHOOK); unset
// = silent, everything still lands in Cloud Logging. Best-effort: a Slack
// outage never fails a job.
import env from '../config/env.js';

export async function postAdmin(text) {
  const hook = env.SLACK_ADMIN_WEBHOOK;
  if (!hook) return false;
  try {
    const r = await fetch(hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text }) });
    return r.ok;
  } catch (e) {
    console.warn(JSON.stringify({ severity: 'WARNING', msg: 'slack post failed', error: String((e && e.message) || e) }));
    return false;
  }
}
