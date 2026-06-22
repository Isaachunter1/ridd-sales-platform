// Manual "Sync now" trigger — lets a signed-in ADMIN refresh the RevHawk
// snapshot mid-day from a button in the app (no Terminal, no shared secret in
// the browser). It verifies the caller's Supabase session is an admin (same
// gate as admin-set-password), then fires the background worker server-side
// (which holds the real sync secret). Returns synchronously so the button gets
// real feedback.
//
//   POST /api/revhawk-sync-now   with  Authorization: Bearer <session JWT>

const { createClient } = require('@supabase/supabase-js');

const json = (s, o) => ({ statusCode: s, headers: { 'content-type': 'application/json' }, body: JSON.stringify(o) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY     = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json(500, { error: 'Server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY' });
  }

  // ── Auth gate: caller must be a signed-in admin ──
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Sign in required.' });
  const verifier = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userRes, error: userErr } = await verifier.auth.getUser(jwt);
  if (userErr || !userRes?.user) return json(401, { error: 'Invalid session.' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: prof, error: profErr } = await admin.from('profiles').select('role').eq('id', userRes.user.id).maybeSingle();
  if (profErr) return json(500, { error: 'Profile lookup failed: ' + profErr.message });
  if (!prof || !['admin', 'admin_rep'].includes(prof.role)) return json(403, { error: 'Admins only.' });

  // ── Fire the background worker (it carries the 15-min budget + the secret) ──
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return json(500, { error: 'No site URL available to trigger the sync.' });
  try {
    await fetch(base + '/.netlify/functions/revhawk-sync-background', {
      method: 'POST',
      headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' },
    });
  } catch (e) {
    return json(502, { error: 'Could not start the sync: ' + String((e && e.message) || e) });
  }
  return json(200, { ok: true, message: 'Sync started — fresh data lands in about a minute. Reload Reporting after that.' });
};
