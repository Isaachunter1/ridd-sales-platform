// Commission-run email fan-out — "Run Commissions" on the D2D Upfront tab
// posts each rep's pay summary here; we email every rep at the address on
// their FIELDROUTES account (the roster email the client sends per recipient).
//
// SETUP
// -----
// 1. Netlify env vars (Site settings → Environment variables):
//      RESEND_API_KEY         = re_...        (resend.com → API Keys)
//      COMMISSION_FROM_EMAIL  = RIDD Pay <pay@yourdomain.com>
//                               (domain must be verified in Resend)
//    Plus the Supabase trio already set for admin-set-password:
//      SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY
// 2. netlify.toml redirect (added):
//      /api/commission-email → /.netlify/functions/commission-email
//
// REQUEST SHAPE
// -------------
// POST /api/commission-email
// Headers: Authorization: Bearer <caller's Supabase session JWT>  (admin only)
// Body: { period: "Jul 19 – Jul 25", recipients: [{ email, name, subject, html }, ...] }
//
// RESPONSE: 200 { ok: true, sent: N, failed: [{ email, error }] }
//
// SECURITY: same admin JWT gate as admin-set-password — any authenticated
// non-admin gets a 403, so reps can't trigger (or spoof) pay emails.

const { createClient } = require('@supabase/supabase-js');

const json = (statusCode, body) => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });

  const RESEND_KEY = process.env.RESEND_API_KEY;
  const FROM = process.env.COMMISSION_FROM_EMAIL;
  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!RESEND_KEY || !FROM) return json(500, { error: 'Server missing RESEND_API_KEY / COMMISSION_FROM_EMAIL env vars' });
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json(500, { error: 'Server missing Supabase env vars' });

  // ── Admin gate (same pattern as admin-set-password) ──
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Missing Authorization bearer token' });
  const verifier = createClient(SUPABASE_URL, ANON_KEY);
  const { data: userRes, error: userErr } = await verifier.auth.getUser(jwt);
  if (userErr || !userRes?.user) return json(401, { error: 'Invalid session token' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: prof, error: profErr } = await admin.from('profiles').select('id, role').eq('id', userRes.user.id).maybeSingle();
  if (profErr) return json(500, { error: 'Profile lookup failed: ' + profErr.message });
  if (!prof || !['admin', 'admin_rep'].includes(prof.role)) return json(403, { error: 'Admin role required' });

  // ── Payload ──
  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) { return json(400, { error: 'Bad JSON: ' + e.message }); }
  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  if (!recipients.length) return json(400, { error: 'recipients required' });
  if (recipients.length > 200) return json(400, { error: 'Too many recipients in one run (max 200)' });

  const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(e || '').trim());
  const failed = [];
  let sent = 0;
  for (const r of recipients) {
    const to = String(r.email || '').trim();
    if (!okEmail(to)) { failed.push({ email: to || '(blank)', error: 'invalid email' }); continue; }
    try {
      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${RESEND_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: FROM,
          to: [to],
          subject: r.subject || ('Your RIDD commission' + (body.period ? ' · ' + body.period : '')),
          html: r.html || '<p>Your commission has been run. Open the RIDD Sales app to see your pay.</p>',
        }),
      });
      if (!res.ok) {
        const t = await res.text().catch(() => '');
        failed.push({ email: to, error: `resend ${res.status}: ${t.slice(0, 140)}` });
      } else sent++;
      // Resend free tier rate-limits ~2 req/s — pace the fan-out.
      await new Promise(ok => setTimeout(ok, 600));
    } catch (e) {
      failed.push({ email: to, error: String((e && e.message) || e) });
    }
  }
  console.log(`[commission-email] period=${body.period || '—'} sent=${sent} failed=${failed.length}`);
  return json(200, { ok: true, sent, failed });
};
