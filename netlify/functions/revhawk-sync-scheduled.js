// Daily trigger for the RevHawk sync. Netlify runs this on a cron; it simply
// fires the background worker (which has the 15-minute budget) and returns —
// the actual BigQuery → Supabase work happens in revhawk-sync-background.js.
//
// Cron: 12:00 UTC daily ≈ early morning across RIDD's US branches
// (6am Mountain / 7am Central / 8am Eastern), so the team starts the day on
// fresh CRM data. Change the cron string below to re-time it.

const { schedule } = require('@netlify/functions');

exports.handler = schedule('0 12 * * *', async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return { statusCode: 500, body: 'no site URL available' };
  try {
    // Background functions return 202 immediately; this just kicks it off.
    await fetch(base + '/.netlify/functions/revhawk-sync-background', {
      method: 'POST',
      headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' },
    });
  } catch (e) {
    console.error('[revhawk-sync-scheduled] trigger failed', e);
  }
  return { statusCode: 200 };
});
