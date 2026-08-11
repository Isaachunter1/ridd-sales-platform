// 📣 In-app feedback → Slack (per Isaac). POST { text, view } with the
// caller's Supabase JWT; posts to SLACK_ADMIN_WEBHOOK with who/where so
// user reports land in Slack instead of hallway conversations.
// ENV: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_ANON_KEY,
//      SLACK_ADMIN_WEBHOOK (falls back to SLACK_TEAMLEAD_WEBHOOK).
const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY: KEY, SUPABASE_ANON_KEY: ANON } = process.env;
  const HOOK = process.env.SLACK_ADMIN_WEBHOOK || process.env.SLACK_TEAMLEAD_WEBHOOK;
  if (!SUPABASE_URL || !KEY || !ANON) return json(500, { error: 'missing Supabase env' });

  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'missing bearer token' });
  const verifier = createClient(SUPABASE_URL, ANON);
  const { data: userRes, error: uErr } = await verifier.auth.getUser(jwt);
  if (uErr || !userRes?.user) return json(401, { error: 'invalid session' });

  let body;
  try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad JSON' }); }
  const text = String(body.text || '').trim().slice(0, 2000);
  const view = String(body.view || '').slice(0, 60);
  if (!text) return json(400, { error: 'text required' });

  const admin = createClient(SUPABASE_URL, KEY, { auth: { persistSession: false } });
  const { data: prof } = await admin.from('profiles')
    .select('full_name, role, email').eq('id', userRes.user.id).maybeSingle();
  const who = (prof && prof.full_name) || (prof && prof.email) || 'unknown user';
  const role = (prof && prof.role) || '?';

  // Log the event regardless of Slack config (adoption trail).
  try {
    await admin.from('usage_events').insert({
      profile_id: userRes.user.id, event: 'feedback', detail: (view ? '[' + view + '] ' : '') + text.slice(0, 500),
    });
  } catch (e) { /* table may not exist yet */ }

  if (!HOOK) return json(200, { ok: true, slack: false });
  const res = await fetch(HOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: '📣 *App feedback* from *' + who + '* (' + role + (view ? ' · ' + view + ' tab' : '') + '):\n> ' + text }),
  });
  if (!res.ok) return json(502, { error: 'Slack webhook HTTP ' + res.status });
  return json(200, { ok: true, slack: true });
};

function json(statusCode, body) {
  return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) };
}
