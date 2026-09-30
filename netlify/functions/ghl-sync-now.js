// Admin "Sync now" (Settings → Configurations → GoHighLevel sources): kicks
// the background sync with the server-side secret. Admin / admin_rep only.
exports.handler = async (event) => {
  const { requireRole } = require('../lib/auth-gate.js');
  const gate = await requireRole(event, ['admin', 'admin_rep']);
  if (!gate.ok) return gate.response;
  if (!process.env.GHL_PRIVATE_TOKEN || !process.env.GHL_LOCATION_ID) return { statusCode: 400, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ error: 'GHL_PRIVATE_TOKEN / GHL_LOCATION_ID not set' }) };
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  const r = await fetch(base + '/.netlify/functions/ghl-contacts-sync-background', { method: 'POST', headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' } });
  return { statusCode: r.status === 202 || r.ok ? 202 : 502, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ started: r.status === 202 || r.ok, status: r.status }) };
};
