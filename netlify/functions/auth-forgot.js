// Forgot-password check (per Isaac, Sep 22 2026). The login screen's
// "Forgot password" must only say "reset link sent" when the address is an
// ACTUAL user of the app; otherwise it tells the person plainly that there
// is no account with that email. The browser can't read `profiles` before
// sign-in (RLS), so this function looks the address up with the service role
// and, when it is a real active user, sends the reset email itself.
//
// POST /api/auth-forgot   { email, redirectTo }
//   200 { exists: true,  sent: true }
//   200 { exists: false }             ← no profile (or access revoked)
//   429 { error }                     ← Supabase rate limit
// Trade-off (deliberate, Isaac's call): this confirms whether an email is a
// RIDD login. Requests are rate-limited by Supabase's own reset throttle.

const { createClient } = require('@supabase/supabase-js');

function json(statusCode, body) { return { statusCode, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }; }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY) return json(500, { error: 'Server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY' });
  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'Invalid JSON' }); }
  const email = String(body.email || '').trim().toLowerCase();
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(400, { error: 'Enter the email you sign in with.' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
  try {
    const { data: prof, error } = await admin.from('profiles').select('id, is_active, access_revoked_at').ilike('email', email).limit(1).maybeSingle();
    if (error) return json(500, { error: 'Lookup failed: ' + error.message });
    if (!prof || prof.is_active === false || prof.access_revoked_at) return json(200, { exists: false });
    const redirectTo = String(body.redirectTo || '').trim() || undefined;
    const { error: sendErr } = await admin.auth.resetPasswordForEmail(email, redirectTo ? { redirectTo } : undefined);
    if (sendErr) {
      if (/rate limit|security purposes/i.test(sendErr.message || '')) return json(429, { error: 'Too many reset requests — wait a minute and try once more.' });
      return json(500, { error: sendErr.message || 'Could not send the reset email' });
    }
    return json(200, { exists: true, sent: true });
  } catch (e) {
    return json(500, { error: (e && e.message) || 'auth-forgot failed' });
  }
};
