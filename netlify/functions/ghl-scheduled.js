// Hourly: kick the GoHighLevel contacts sync (schedule in netlify.toml).
exports.handler = async () => {
  if (!process.env.GHL_PRIVATE_TOKEN || !process.env.GHL_LOCATION_ID) return { statusCode: 200, body: 'GHL env not set — skipped' };
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return { statusCode: 500, body: 'no site URL available' };
  try { const r = await fetch(base + '/.netlify/functions/ghl-contacts-sync-background', { method: 'POST', headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' } }); console.log('[ghl-scheduled] HTTP', r.status); }
  catch (e) { console.error('[ghl-scheduled] kick failed', e); }
  return { statusCode: 200, body: 'kicked' };
};
