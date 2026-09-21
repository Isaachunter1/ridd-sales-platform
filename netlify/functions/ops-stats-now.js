// Admin-only kick for the operations weekly-stats worker (COO tab) — "Refresh
// now" button on Reporting → Operations. Same shape as crm-deleted-scan-now.
const { requireRole } = require('../lib/auth-gate.js');
const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const gate = await requireRole(event, ['admin', 'admin_rep']);
  if (!gate.ok) return gate.response;
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return json(500, { error: 'No site URL available.' });
  try {
    const r = await fetch(base + '/.netlify/functions/ops-stats-background', { method: 'POST', headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' } });
    if (r.status >= 400) return json(502, { error: 'Worker refused the kick (HTTP ' + r.status + ')' });
  } catch (e) { return json(502, { error: 'Could not start the refresh: ' + String((e && e.message) || e) }); }
  return json(200, { ok: true, message: 'Operations stats refresh started — about a minute. Reload the tab after that.' });
};
