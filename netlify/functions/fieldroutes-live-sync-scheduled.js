// Every 15 minutes during selling hours: kick the FieldRoutes live pull so
// new subscriptions reach the Sales queues the same day (RevHawk is nightly).
// Schedule lives in netlify.toml [functions."fieldroutes-live-sync-scheduled"].
exports.handler = async () => {
  if (!process.env.FIELDROUTES_AUTH_KEY) return { statusCode: 200, body: 'fieldroutes env not set — skipped' };
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, hourCycle: 'h23' }).format(new Date()));
  if (!(etHour >= 7 && etHour <= 23)) return { statusCode: 200, body: 'outside selling hours — skipped' };
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return { statusCode: 500, body: 'no site URL available' };
  try {
    const res = await fetch(base + '/.netlify/functions/fieldroutes-live-sync-background', { method: 'POST', headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' } });
    console.log('[fr-live-scheduled] kick -> HTTP', res.status);
  } catch (e) {
    console.error('[fr-live-scheduled] trigger failed', e);
  }
  return { statusCode: 200, body: 'kicked' };
};
