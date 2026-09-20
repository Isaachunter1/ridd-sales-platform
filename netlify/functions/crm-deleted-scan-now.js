// Admin-only kick for the deleted-in-FieldRoutes scan (P1-8 in AUDIT.md):
// the nightly run is at 4am ET; this lets an admin run it on demand from
// the Retention tab's "deleted in FieldRoutes" step. Same shape as
// revhawk-sync-now: verify the session, check the role, fire the
// background worker with the shared secret.
const { requireRole } = require('../lib/auth-gate.js');
const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const gate = await requireRole(event, ['admin', 'admin_rep']);
  if (!gate.ok) return gate.response;
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return json(500, { error: 'No site URL available.' });
  try {
    const r = await fetch(base + '/.netlify/functions/crm-deleted-scan-background', { method: 'POST', headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' } });
    if (r.status >= 400) return json(502, { error: 'Worker refused the kick (HTTP ' + r.status + ')' });
  } catch (e) { return json(502, { error: 'Could not start the scan: ' + String((e && e.message) || e) }); }
  return json(200, { ok: true, message: 'FieldRoutes check started — about two minutes for ~90 calls. Reload Retention after that.' });
};
