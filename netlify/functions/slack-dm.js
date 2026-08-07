// Per-user Slack DM sender (per Isaac). POST { user_id, text } with the
// caller's Supabase JWT. Sends a DM to the target user's Slack (their
// Member ID from ⚙ My Settings) IF they've enabled notifications.
//
// SECURITY: caller must be signed in; may target THEMSELVES, or anyone if
// they're an admin/auditor (auditors notify reps of audit results).
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      SLACK_BOT_TOKEN (Slack app bot token with chat:write + im:write).
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY, SUPABASE_ANON_KEY: ANON, SLACK_BOT_TOKEN: BOT } = process.env;
  if (!SUPABASE_URL || !KEY || !ANON) return json(500, { error: 'missing Supabase env' });
  if (!BOT) return json(200, { ok: false, skipped: 'no SLACK_BOT_TOKEN configured' });

  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'missing bearer token' });
  const verifier = createClient(SUPABASE_URL, ANON);
  const { data: userRes, error: uErr } = await verifier.auth.getUser(jwt);
  if (uErr || !userRes?.user) return json(401, { error: 'invalid session' });
  const callerId = userRes.user.id;

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad JSON' }); }
  const { user_id, text } = body;
  if (!user_id || !text) return json(400, { error: 'user_id and text required' });

  const admin = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
  if (user_id !== callerId) {
    const { data: caller } = await admin.from('profiles').select('role').eq('id', callerId).maybeSingle();
    if (!caller || !['admin', 'admin_rep', 'auditor'].includes(caller.role)) {
      return json(403, { error: 'not allowed to notify other users' });
    }
  }

  const { data: target } = await admin.from('profiles')
    .select('slack_member_id, slack_notify, full_name').eq('id', user_id).maybeSingle();
  if (!target) return json(404, { error: 'user not found' });
  if (!target.slack_notify || !target.slack_member_id) return json(200, { ok: false, skipped: 'user has Slack notifications off' });

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + BOT },
    body: JSON.stringify({ channel: target.slack_member_id, text: String(text).slice(0, 3000) }),
  });
  const out = await res.json().catch(() => ({}));
  if (!out.ok) return json(502, { error: 'Slack: ' + (out.error || 'unknown') });
  return json(200, { ok: true });
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
