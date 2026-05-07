// Slack relay function — bridges the browser-side `slack.sendDM` call in
// index.html to Slack's `chat.postMessage` API. The bot token can't live
// in the static frontend (CORS + token-leak), so this serverless function
// holds it and fans out the message to each rep.
//
// SETUP
// -----
// 1. Add `SLACK_BOT_TOKEN=xoxb-...` to your Netlify site env vars
//    (Netlify dashboard → Site settings → Environment variables).
//    Token needs scopes: `chat:write` (DM users) and `im:write` (open DM channels).
// 2. Deploy. Netlify auto-detects `netlify/functions/*.js` and exposes them at
//    `/.netlify/functions/<name>`. The frontend uses the friendlier
//    `/api/slack-paystub` path — add this redirect to `netlify.toml`:
//
//      [[redirects]]
//        from = "/api/slack-paystub"
//        to   = "/.netlify/functions/slack-paystub"
//        status = 200
//
// 3. (Optional) Restrict to authenticated callers. The simplest approach is
//    to verify a Supabase session JWT on the request — see the auth-gate
//    block below; uncomment + set SUPABASE_JWT_SECRET to enable.
//
// REQUEST SHAPE
// -------------
//   POST /api/slack-paystub
//   {
//     recipients: [{ slack_user_id: "U01...", full_name: "Pere LeSueur" }, ...],
//     payload:    { text: "...", blocks: [...] },   // Block Kit message
//     kind:       "paystub_upfront" | "paystub_backend" | "dm"
//   }
//
// RESPONSE SHAPE
// --------------
//   { sent: <number>, failed: <number>, errors: { [slack_user_id]: "reason" } }

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'POST only' }) };
  }

  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'SLACK_BOT_TOKEN env var not set' }),
    };
  }

  // ── Optional: Supabase JWT auth gate ────────────────────────────────────
  // Uncomment when you've wired Supabase auth and want to make sure only
  // signed-in admins can trigger sends.
  //
  // const jwt = (event.headers.authorization || '').replace(/^Bearer\s+/i, '');
  // if (!jwt) return { statusCode: 401, body: JSON.stringify({ error: 'No token' }) };
  // try {
  //   const { data: user, error } = await supabaseAdmin.auth.getUser(jwt);
  //   if (error || !user) throw new Error('Invalid JWT');
  //   // optionally: check that user.role === 'admin' on your profiles table
  // } catch (err) {
  //   return { statusCode: 401, body: JSON.stringify({ error: err.message }) };
  // }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad JSON: ' + err.message }) };
  }

  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  const payload = body.payload || {};
  if (recipients.length === 0) {
    return { statusCode: 200, body: JSON.stringify({ sent: 0, failed: 0, errors: {} }) };
  }
  if (!payload.text && !payload.blocks) {
    return { statusCode: 400, body: JSON.stringify({ error: 'payload.text or payload.blocks required' }) };
  }

  let sent = 0;
  let failed = 0;
  const errors = {};

  // Slack rate limits chat.postMessage to ~1/second per user, but the global
  // tier-3 budget is much higher. We fan out concurrently with a small cap
  // so a 50-rep run doesn't take 50 seconds.
  const CONCURRENCY = 6;
  const queue = recipients.slice();
  const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
    while (queue.length) {
      const r = queue.shift();
      if (!r?.slack_user_id) { failed++; continue; }
      try {
        const res = await fetch('https://slack.com/api/chat.postMessage', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            Authorization: 'Bearer ' + token,
          },
          body: JSON.stringify({
            channel: r.slack_user_id,
            text: payload.text || '',
            blocks: payload.blocks || undefined,
            unfurl_links: false,
            unfurl_media: false,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (data && data.ok) {
          sent++;
        } else {
          failed++;
          errors[r.slack_user_id] = data?.error || ('HTTP ' + res.status);
        }
      } catch (err) {
        failed++;
        errors[r.slack_user_id] = err?.message || String(err);
      }
    }
  });

  await Promise.all(workers);

  return {
    statusCode: 200,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sent, failed, errors }),
  };
};
