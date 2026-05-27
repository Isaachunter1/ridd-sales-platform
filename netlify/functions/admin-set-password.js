// Admin password-setter — lets an admin create a user with a password
// (no magic-link round-trip) or reset an existing user's password from
// the in-app Users editor. The browser SDK can only update the CURRENT
// session's password, so anything that touches another user's password
// has to go through this function with the service-role key.
//
// SETUP
// -----
// 1. Netlify dashboard → Site settings → Environment variables, add:
//      SUPABASE_URL              = https://<project-ref>.supabase.co
//      SUPABASE_SERVICE_ROLE_KEY = eyJ... (Project Settings → API → service_role)
//      SUPABASE_ANON_KEY         = eyJ... (Project Settings → API → anon public)
//    The service role key bypasses RLS — KEEP IT SERVER-SIDE ONLY.
//
// 2. netlify.toml already has the redirect:
//      [[redirects]]
//        from = "/api/admin-set-password"
//        to   = "/.netlify/functions/admin-set-password"
//        status = 200
//
// REQUEST SHAPE
// -------------
// POST /api/admin-set-password
// Headers:
//   Authorization: Bearer <caller's Supabase session JWT>
// Body:
//   {
//     mode: 'create' | 'update',
//     password: '...',                  // required, ≥ 8 chars
//     // For 'create':
//     email: '...', full_name: '...', role: 'rep'|'admin_rep'|..., office_id?: ...,
//     // For 'update':
//     user_id: '<auth user uuid>',
//   }
//
// RESPONSE
// --------
// 200 { ok: true, user_id: '...' }
// 4xx { error: '...' }
//
// SECURITY
// --------
// We verify the caller's JWT against Supabase, then look up their
// profile row and require role ∈ {admin, admin_rep}. Without this check
// any authenticated user could escalate privileges by hitting this
// endpoint directly with their own JWT.

const { createClient } = require('@supabase/supabase-js');

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'POST only' });
  }

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY     = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) {
    return json(500, { error: 'Server missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY env vars' });
  }

  // ── Auth gate: verify the caller is signed in as an admin ───────────
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Missing Authorization bearer token' });

  // Anon-key client just to verify the JWT belongs to a real user.
  const verifier = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userRes, error: userErr } = await verifier.auth.getUser(jwt);
  if (userErr || !userRes?.user) return json(401, { error: 'Invalid session token' });
  const callerId = userRes.user.id;

  // Service-role client for the privileged work below.
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Confirm the caller's profile row carries an admin role.
  const { data: callerProfile, error: profErr } = await admin
    .from('profiles')
    .select('id, role')
    .eq('id', callerId)
    .maybeSingle();
  if (profErr) return json(500, { error: 'Profile lookup failed: ' + profErr.message });
  if (!callerProfile || !['admin', 'admin_rep'].includes(callerProfile.role)) {
    return json(403, { error: 'Admin role required' });
  }

  // ── Parse request body ─────────────────────────────────────────────
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (err) { return json(400, { error: 'Bad JSON: ' + err.message }); }

  const { mode, password } = body;
  if (!['create', 'update'].includes(mode)) {
    return json(400, { error: 'mode must be "create" or "update"' });
  }
  if (typeof password !== 'string' || password.length < 8) {
    return json(400, { error: 'Password must be at least 8 characters' });
  }

  try {
    if (mode === 'create') {
      const { email, full_name, role, office_id, initials, avatar_url, annual_revenue_goal } = body;
      if (!email)    return json(400, { error: 'email required for create' });
      if (!role)     return json(400, { error: 'role required for create' });

      // Refresh the pending_invites row so the existing handle_new_user
      // trigger picks up the latest profile metadata when it copies
      // into `profiles`. Same shape the OTP flow upserts.
      const { error: pendingErr } = await admin.from('pending_invites').upsert({
        email,
        full_name: full_name || '',
        role,
        office_id:           office_id ?? null,
        initials:            initials ?? null,
        avatar_url:          avatar_url ?? null,
        annual_revenue_goal: annual_revenue_goal ?? null,
        created_by:          callerId,
      }, { onConflict: 'email' });
      if (pendingErr) return json(500, { error: 'pending_invites upsert failed: ' + pendingErr.message });

      // Create the auth user with the password directly — email_confirm
      // skips the magic-link confirmation step so the rep can sign in
      // immediately with email + password.
      const { data: created, error: createErr } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { full_name: full_name || '' },
      });
      if (createErr) return json(500, { error: 'createUser failed: ' + createErr.message });

      return json(200, { ok: true, user_id: created.user?.id });
    }

    // mode === 'update'
    const { user_id } = body;
    if (!user_id) return json(400, { error: 'user_id required for update' });
    // Don't let an admin lock themselves out by mistake — they can still
    // change their OWN password through the normal Supabase flow, but
    // this endpoint stays focused on managing other users.
    const { error: updErr } = await admin.auth.admin.updateUserById(user_id, { password });
    if (updErr) return json(500, { error: 'updateUserById failed: ' + updErr.message });
    return json(200, { ok: true, user_id });
  } catch (err) {
    return json(500, { error: 'Unexpected: ' + (err.message || String(err)) });
  }
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}
