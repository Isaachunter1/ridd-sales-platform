// ── Shared auth gate for Netlify functions ──────────────────────────────
// Apple mindset: every endpoint is CLOSED unless the caller proves who they
// are. Verifies the caller's Supabase session JWT and (optionally) their
// role from the profiles table. Used by every data-bearing function.
//
//   const { requireRole } = require('../lib/auth-gate.js');
//   const gate = await requireRole(event, ['admin', 'admin_rep']);
//   if (!gate.ok) return gate.response;
//   // gate.user, gate.role available
const { createClient } = require('@supabase/supabase-js');

const deny = (status, error) => ({
  ok: false,
  response: { statusCode: status, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error }) },
});

async function requireRole(event, roles) {
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return deny(500, 'Server missing Supabase env');
  const jwt = ((event.headers || {}).authorization || (event.headers || {}).Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return deny(401, 'Sign in required.');
  const verifier = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userRes, error: userErr } = await verifier.auth.getUser(jwt);
  if (userErr || !userRes?.user) return deny(401, 'Invalid session.');
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: prof, error: profErr } = await admin.from('profiles').select('role').eq('id', userRes.user.id).maybeSingle();
  if (profErr) return deny(500, 'Profile lookup failed');
  const role = prof && prof.role;
  if (!role || role === 'disabled') return deny(403, 'Account inactive.');
  if (Array.isArray(roles) && roles.length && !roles.includes(role)) return deny(403, 'Not permitted for this account.');
  return { ok: true, user: userRes.user, role };
}

module.exports = { requireRole };
