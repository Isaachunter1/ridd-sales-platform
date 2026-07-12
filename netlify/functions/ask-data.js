// ── Ask-the-data assistant (admin only) ─────────────────────────────────
// The app's 💬 widget POSTs {question, history, context} here. The context
// is a compact JSON snapshot of what the admin is looking at (leaderboards,
// goals, sync freshness) built client-side from the same numbers on screen.
// This function verifies the caller is a signed-in ADMIN (same gate as
// revhawk-sync-now), then asks Anthropic and returns the answer.
//
// Env: ANTHROPIC_API_KEY (required) · ASK_DATA_MODEL (optional override)
const { createClient } = require('@supabase/supabase-js');

const json = (s, o) => ({ statusCode: s, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  const API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json(500, { error: 'Server missing Supabase env' });
  if (!API_KEY) return json(500, { error: 'ANTHROPIC_API_KEY is not set in Netlify env — add it to enable the assistant.' });

  // ── Auth gate: signed-in admin only ──
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Sign in required.' });
  const verifier = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userRes, error: userErr } = await verifier.auth.getUser(jwt);
  if (userErr || !userRes?.user) return json(401, { error: 'Invalid session.' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: prof } = await admin.from('profiles').select('role').eq('id', userRes.user.id).maybeSingle();
  if (!prof || !['admin', 'admin_rep'].includes(prof.role)) return json(403, { error: 'Admins only.' });

  let body = {};
  try { body = JSON.parse(event.body || '{}'); } catch { return json(400, { error: 'bad json' }); }
  const question = String(body.question || '').slice(0, 4000);
  if (!question.trim()) return json(400, { error: 'Ask something first.' });
  const context = String(typeof body.context === 'string' ? body.context : JSON.stringify(body.context || {})).slice(0, 60000);
  // Short rolling history [{role:'user'|'assistant', content}] keeps follow-ups coherent.
  const history = (Array.isArray(body.history) ? body.history : [])
    .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    .slice(-10)
    .map(m => ({ role: m.role, content: m.content.slice(0, 4000) }));

  const system = [
    'You are the data assistant inside the RIDD sales platform (pest control, door-to-door + inside sales).',
    'The user is an ADMIN looking at live dashboards. A JSON snapshot of the current data is provided below —',
    'it was computed by the app from the FieldRoutes CRM sync and is the same data shown on screen.',
    'Answer questions about it concisely and numerically. Show your math when deriving figures.',
    'If the snapshot does not contain what is needed, say what is missing rather than guessing.',
    'Dollar figures: round to whole dollars. Dates in the snapshot are business days (Eastern).',
    '',
    'DATA SNAPSHOT:',
    context,
  ].join('\n');

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: process.env.ASK_DATA_MODEL || 'claude-sonnet-4-5',
        max_tokens: 1200,
        system,
        messages: history.concat([{ role: 'user', content: question }]),
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) {
      const msg = (j && j.error && j.error.message) || ('HTTP ' + r.status);
      return json(502, { error: 'Assistant error: ' + String(msg).slice(0, 300) });
    }
    const text = ((j.content || []).find(c => c.type === 'text') || {}).text || '';
    return json(200, { ok: true, answer: text });
  } catch (e) {
    return json(502, { error: 'Assistant unreachable: ' + String((e && e.message) || e).slice(0, 200) });
  }
};
