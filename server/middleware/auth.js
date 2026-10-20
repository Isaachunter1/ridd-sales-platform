// Supabase JWT gate — ported from netlify/lib/auth-gate.js (requireRole).
// Every endpoint is CLOSED unless the caller proves who they are: verify the
// session JWT with the anon client, then read the role from profiles with the
// service-role client. Same messages, same status codes as before.
//
//   router.post('/thing', requireRole(['admin', 'admin_rep']), handler)
//   router.get('/thing',  requireRole(), handler)          // any signed-in, non-disabled user
//
// On success req.user (auth user) and req.role are set.
import { supabase, supabaseAnon } from '../config/supabase.js';
import { hasApiToken } from './apiToken.js';

export async function resolveCaller(req) {
  const jwt = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { ok: false, status: 401, error: 'Sign in required.' };
  const { data: userRes, error: userErr } = await supabaseAnon.auth.getUser(jwt);
  if (userErr || !userRes?.user) return { ok: false, status: 401, error: 'Invalid session.' };
  const { data: prof, error: profErr } = await supabase.from('profiles').select('role').eq('id', userRes.user.id).maybeSingle();
  if (profErr) return { ok: false, status: 500, error: 'Profile lookup failed' };
  const role = prof && prof.role;
  if (!role || role === 'disabled') return { ok: false, status: 403, error: 'Account inactive.' };
  return { ok: true, user: userRes.user, role };
}

export function requireRole(roles) {
  return async (req, res, next) => {
    const r = await resolveCaller(req);
    if (!r.ok) return res.status(r.status).json({ error: r.error });
    if (Array.isArray(roles) && roles.length && !roles.includes(r.role)) return res.status(403).json({ error: 'Not permitted for this account.' });
    req.user = r.user; req.role = r.role; req.caller = { kind: 'user', id: r.user.id, role: r.role };
    next();
  };
}

// /jobs/<name>: Cloud Scheduler's token OR an admin's JWT ("Refresh now").
export const ADMIN_ROLES = ['admin', 'admin_rep'];
export async function requireSchedulerOrAdmin(req, res, next) {
  if (hasApiToken(req)) { req.caller = { kind: 'scheduler' }; return next(); }
  return requireRole(ADMIN_ROLES)(req, res, next);
}
