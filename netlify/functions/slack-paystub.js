// Slack relay function — bridges the browser-side `slack.sendDM` call in
// index.html to Slack's `chat.postMessage` API. The bot token can't live
// in the static frontend (CORS + token-leak), so this serverless function
// holds it and fans out the message to each rep.
//
// SETUP
// -----
// 1. Add `SLACK_BOT_TOKEN=xoxb-...` to your Netlify site env vars
//    (Netlify dashboard → Site settings → Environment variables).
//    Token needs scopes: `chat:write` (DM users), `im:write` (open DM channels) and
//    `files:write` (the PDF pay stubs, Oct 15).
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
  // ── Auth: admins only (shared gate) — this endpoint serves company
  // the company Slack bot (anyone could DM the team) and was previously open to the internet. ──
  const { requireRole } = require('../lib/auth-gate.js');
  const gate = await requireRole(event, ['admin', 'admin_rep']);
  if (!gate.ok) return gate.response;
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

  // (Auth: requireRole above — admins only.)

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (err) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Bad JSON: ' + err.message }) };
  }

  const recipients = Array.isArray(body.recipients) ? body.recipients : [];
  const payload = body.payload || {};

  // ── PDF pay stub (per Isaac, Oct 15): { file: { filename, title, base64 } } → uploaded into each
  // recipient's DM with payload.text as the message. Slack's external-upload flow:
  // conversations.open → files.getUploadURLExternal → POST bytes → files.completeUploadExternal.
  // Bot scopes: chat:write, im:write, files:write.
  if (body.file && body.file.base64) {
    const buf = Buffer.from(String(body.file.base64), 'base64');
    if (!buf.length || buf.length > 4 * 1024 * 1024) return { statusCode: 413, body: JSON.stringify({ error: 'file empty or over 4 MB' }) };
    if (buf.slice(0, 5).toString('latin1') !== '%PDF-') return { statusCode: 400, body: JSON.stringify({ error: 'PDF only' }) };
    const filename = String(body.file.filename || 'paystub.pdf').replace(/[^A-Za-z0-9._-]/g, '-').slice(0, 120);
    const title = String(body.file.title || filename).slice(0, 200);
    const slack = async (method, params, form) => {
      const res = await fetch('https://slack.com/api/' + method, {
        method: 'POST',
        headers: form ? { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Bearer ' + token } : { 'Content-Type': 'application/json; charset=utf-8', Authorization: 'Bearer ' + token },
        body: form ? new URLSearchParams(params).toString() : JSON.stringify(params),
      });
      const data = await res.json().catch(() => ({}));
      if (!data.ok) throw new Error(method + ': ' + (data.error || ('HTTP ' + res.status)));
      return data;
    };
    let sentF = 0, failedF = 0; const errorsF = {};
    for (const r of recipients) {
      const uid = String((r && r.slack_user_id) || '');
      if (!/^[UW][A-Z0-9]{6,}$/.test(uid)) { failedF++; errorsF[uid || '?'] = 'bad Slack member id'; continue; }
      try {
        const dm = await slack('conversations.open', { users: uid });
        const up = await slack('files.getUploadURLExternal', { filename, length: String(buf.length) }, true);
        const put = await fetch(up.upload_url, { method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: buf });
        if (!put.ok) throw new Error('upload: HTTP ' + put.status);
        await slack('files.completeUploadExternal', { files: [{ id: up.file_id, title }], channel_id: dm.channel.id, initial_comment: String(payload.text || '') });
        sentF++;
      } catch (err) { failedF++; errorsF[uid] = err.message || String(err); }
    }
    return { statusCode: 200, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sent: sentF, failed: failedF, errors: errorsF }) };
  }
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
