// RevHawk connection TEST — a synchronous endpoint so the result/error is
// visible straight from the Terminal (unlike the background sync, whose errors
// only land in Netlify logs). It does the exact same service-account auth, then
// runs a tiny COUNT query against the dataset and returns what happened.
//
//   curl https://YOUR-SITE.netlify.app/api/revhawk-test
//
// Reads the SAME env vars as revhawk-sync-background.js. Use it to confirm the
// credentials + cross-project access work before relying on the nightly sync.

const crypto = require('crypto');

const PROJECT = process.env.REVHAWK_PROJECT_ID || 'revhawkdataconnect';
const DATASET = process.env.REVHAWK_DATASET || 'org_ridd_pest_control_3f4149';
const JOB_PROJECT = process.env.GCP_JOB_PROJECT || PROJECT;

const b64url = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function getCreds() {
  // Most reliable: paste the WHOLE service-account JSON file into GCP_SA_JSON —
  // JSON.parse decodes the private_key's \n escapes correctly, avoiding the
  // newline-mangling that breaks a hand-pasted PEM (the DECODER error).
  const raw = process.env.GCP_SA_JSON;
  if (raw && raw.trim()) {
    const o = JSON.parse(raw);
    return { email: o.client_email, key: o.private_key };
  }
  const email = process.env.GCP_SA_EMAIL;
  let key = process.env.GCP_SA_PRIVATE_KEY || '';
  key = key.replace(/^["']|["']$/g, '').replace(/\\n/g, '\n'); // unwrap quotes + fix \n
  return { email, key };
}
async function getAccessToken() {
  const { email, key } = getCreds();
  if (!email || !key) throw new Error('Set GCP_SA_JSON (whole key file) OR GCP_SA_EMAIL + GCP_SA_PRIVATE_KEY');
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: email,
    scope: 'https://www.googleapis.com/auth/bigquery.readonly',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600,
  }));
  const input = `${header}.${claim}`;
  const sig = b64url(crypto.createSign('RSA-SHA256').update(input).sign(key));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${input}.${sig}`,
  });
  const j = await r.json();
  if (!r.ok || !j.access_token) throw new Error('token exchange failed: ' + JSON.stringify(j).slice(0, 300));
  return j.access_token;
}

exports.handler = async (event) => {
  // ── Auth: requires the sync secret — this endpoint runs a BigQuery query
  // and echoes connection details; it must not be open to the internet. ──
  const need = process.env.REVHAWK_SYNC_SECRET;
  const got = (event && event.headers && (event.headers['x-sync-secret'] || event.headers['X-Sync-Secret'])) || '';
  if (!need || got !== need) return { statusCode: 401, body: 'unauthorized (set x-sync-secret)' };
  const envSeen = {
    GCP_SA_JSON: !!process.env.GCP_SA_JSON,
    GCP_SA_EMAIL: !!process.env.GCP_SA_EMAIL,
    GCP_SA_PRIVATE_KEY: !!process.env.GCP_SA_PRIVATE_KEY,
    GCP_JOB_PROJECT: process.env.GCP_JOB_PROJECT || '(unset → defaults to data project)',
    REVHAWK_PROJECT_ID: PROJECT,
    REVHAWK_DATASET: DATASET,
    SUPABASE_URL: !!process.env.SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: !!process.env.SUPABASE_SERVICE_ROLE_KEY,
  };
  const out = (obj) => ({ statusCode: 200, headers: { 'content-type': 'application/json' }, body: JSON.stringify(obj, null, 2) });
  try {
    const token = await getAccessToken();
    const sql = `SELECT COUNT(*) AS n FROM \`${PROJECT}.${DATASET}.FieldRoutesSubscription\``;
    const r = await fetch(`https://bigquery.googleapis.com/bigquery/v2/projects/${JOB_PROJECT}/queries`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: sql, useLegacySql: false, timeoutMs: 30000 }),
    });
    const j = await r.json();
    if (!r.ok) return out({ ok: false, step: 'bigquery_query', error: (j.error && j.error.message) || j, envSeen });
    const n = j.rows && j.rows[0] && j.rows[0].f[0].v;
    return out({ ok: true, message: 'Auth + BigQuery read working.', subscriptions: n, jobProject: JOB_PROJECT, dataset: `${PROJECT}.${DATASET}`, envSeen });
  } catch (e) {
    return out({ ok: false, step: 'auth', error: String((e && e.message) || e), envSeen });
  }
};
