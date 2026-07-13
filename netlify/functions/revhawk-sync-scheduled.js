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
  // ── WATCHDOG — the failure mode that actually burned us was a kick that
  // SUCCEEDED but a worker that died mid-flight (OOM): every hourly kick
  // returned 202, yet the dataset sat stale for two days. So after kicking,
  // check how old the published dataset actually is. This run's own sync
  // won't have landed yet, so the age reflects the PREVIOUS hour's outcome —
  // >150 min during selling hours means at least one full cycle failed.
  try {
    const hook = process.env.SLACK_ADMIN_WEBHOOK;
    if (hook) {
      const st = await (await fetch(base + '/api/sync-status')).json();
      const stamp = st && st.indicatorsBlob && st.indicatorsBlob.updated_at;
      const ageMin = stamp ? Math.round((Date.now() - Date.parse(stamp)) / 60000) : null;
      if (ageMin == null || ageMin > 150) {
        const lastStage = (st && st.lastRun && st.lastRun.stage) || 'unknown';
        const deriveStage = (st && st.lastDerive && st.lastDerive.stage) || 'unknown';
        await fetch(hook, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: '🚨 RIDD dataset is STALE — published blob is '
            + (ageMin == null ? 'missing' : ageMin + ' min old')
            + ' (sync stage: ' + lastStage + ' · derive stage: ' + deriveStage + '). Check /api/sync-status.' }),
        });
      }
    }
  } catch (e) { console.warn('[revhawk-sync-scheduled] watchdog check failed', e && e.message); }
  return { statusCode: 200, body: 'revhawk sync triggered' };
};
