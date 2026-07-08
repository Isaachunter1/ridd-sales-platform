// Nightly marketing-feed refresh — runs before the workday (cron below, UTC).
//
// Windsor / GoHighLevel / QuickBooks are LIVE read-through relays (the
// Marketing tab pulls them on open, with 30-60 min caching), so this job
// isn't a data dependency. What it does each morning:
//   1. HEALTH CHECK — calls all three relays; a failure (expired QBO token,
//      revoked GHL key, Windsor outage) shows up in the Netlify function
//      logs BEFORE an admin hits a broken card at 9am.
//   2. CACHE WARM — primes the CDN cache so the first Marketing open of the
//      day paints instantly.
// Schedule lives in netlify.toml.
exports.handler = async () => {
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || '';
  const out = {};
  for (const name of ['marketing-spend', 'ghl-leads', 'qbo-spend']) {
    const started = Date.now();
    try {
      const r = await fetch(`${base}/.netlify/functions/${name}?_=${Date.now()}`, { headers: { accept: 'application/json' } });
      const j = await r.json().catch(() => null);
      out[name] = { ok: r.ok && !(j && j.error), status: r.status, error: (j && j.error) || null, ms: Date.now() - started };
    } catch (e) {
      out[name] = { ok: false, error: String((e && e.message) || e), ms: Date.now() - started };
    }
  }
  const failures = Object.entries(out).filter(([, v]) => !v.ok);
  if (failures.length) console.error('[marketing-refresh] FEED FAILURES:', JSON.stringify(out));
  else console.log('[marketing-refresh] all feeds healthy:', JSON.stringify(out));
  return { statusCode: failures.length ? 502 : 200, body: JSON.stringify(out) };
};
