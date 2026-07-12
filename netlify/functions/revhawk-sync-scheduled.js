// Nightly trigger for the RevHawk sync (runs each EVENING — schedule is set in
// netlify.toml [functions."revhawk-sync-scheduled"].schedule, so this needs no
// extra dependency). It just fires the background worker (which has the 15-minute
// budget to pull from BigQuery and write the snapshot) and returns immediately.

exports.handler = async () => {
  // Selling-hours window, enforced HERE in Eastern time — the cron itself is
  // a plain "every hour on the hour" because Netlify silently never fired
  // our range/list expression ("0 0-3,12-23 * * *"): zero scheduled runs,
  // discovered via /api/sync-status. Runs 8am–11pm ET; skips otherwise.
  const etHour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', hour12: false, hourCycle: 'h23' }).format(new Date()));
  if (!(etHour >= 8 && etHour <= 23)) {
    console.log('[revhawk-sync-scheduled] outside selling hours (ET hour ' + etHour + ') — skipping');
    return { statusCode: 200, body: 'outside selling hours — skipped' };
  }
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || process.env.DEPLOY_URL;
  if (!base) return { statusCode: 500, body: 'no site URL available' };
  try {
    // Background functions return 202 immediately; this just kicks it off.
    const res = await fetch(base + '/.netlify/functions/revhawk-sync-background', {
      method: 'POST',
      headers: { 'x-sync-secret': process.env.REVHAWK_SYNC_SECRET || '' },
    });
    console.log('[revhawk-sync-scheduled] kick -> HTTP', res.status);
    if (!res.ok && res.status !== 202) throw new Error('kick returned HTTP ' + res.status);
  } catch (e) {
    console.error('[revhawk-sync-scheduled] trigger failed', e);
    // Silent failures blinded us once already — page the admin channel too.
    try {
      const hook = process.env.SLACK_ADMIN_WEBHOOK;
      if (hook) await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '🚨 RIDD scheduled sync could not start: ' + String((e && e.message) || e) }),
      });
    } catch { /* logs still have it */ }
  }
  return { statusCode: 200, body: 'revhawk sync triggered' };
};
