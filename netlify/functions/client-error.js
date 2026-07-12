// ── Client error telemetry ─────────────────────────────────────────────
// The app POSTs uncaught errors here (deduped + capped client-side) so
// problems on REPS' phones become visible instead of anecdotes ("it's
// glitchy"). Forwards to SLACK_ADMIN_WEBHOOK when set; always lands in
// the Netlify function logs either way. No auth on purpose — errors can
// fire before sign-in — but the payload is size-capped and rate-limited
// per invocation, and nothing here can read or write app data.
exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'POST only' };
  let p = {};
  try { p = JSON.parse(event.body || '{}'); } catch { return { statusCode: 400, body: 'bad json' }; }
  const s = (v, n) => String(v == null ? '' : v).slice(0, n);
  const line = [
    '🐞 RIDD app error',
    s(p.message, 300),
    'view=' + s(p.view, 40),
    'role=' + s(p.role, 20),
    'bundle=' + s(p.bundle, 40),
    'ua=' + s(p.ua, 120),
    p.stack ? '\n```' + s(p.stack, 600) + '```' : '',
  ].filter(Boolean).join(' · ');
  console.log('[client-error]', line);
  try {
    const hook = process.env.SLACK_ADMIN_WEBHOOK;
    if (hook) {
      await fetch(hook, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: line }),
      });
    }
  } catch (e) { console.warn('[client-error] slack forward failed', e && e.message); }
  return { statusCode: 200, body: '{"ok":true}' };
};
