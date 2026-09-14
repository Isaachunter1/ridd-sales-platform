// One-click QuickBooks connect (admin). Sends the browser to Intuit's
// consent screen; qbo-callback.js finishes the handshake and stores the
// refresh token + realm id in Netlify Blobs so qbo-spend.js can pull the
// P&L. Replaces the manual OAuth-playground / paste-a-refresh-token setup.
//
// Open as a plain navigation from the app:  /api/qbo-connect?t=<supabase jwt>
// (a browser redirect can't carry an Authorization header, so the session
// token rides in the query string just for this hop).
//
// Intuit app setup: Keys & credentials → Redirect URIs must include
//   https://<your-site>/api/qbo-callback
const crypto = require('crypto');
const AUTH_URL = 'https://appcenter.intuit.com/connect/oauth2';

async function blobStore() {
  try { const { getStore } = await import('@netlify/blobs'); return getStore('qbo'); } catch { return null; }
}
function siteOrigin(event) {
  const h = event.headers || {};
  const proto = h['x-forwarded-proto'] || 'https';
  const host = h['x-forwarded-host'] || h.host;
  return process.env.URL || `${proto}://${host}`;
}
exports.handler = async (event) => {
  const q = (event && event.queryStringParameters) || {};
  const { requireRole } = require('../lib/auth-gate.js');
  const gate = await requireRole({ headers: { authorization: 'Bearer ' + (q.t || '') } }, ['admin', 'admin_rep']);
  if (!gate.ok) return { statusCode: 403, body: 'Admins only — open this from the Marketing tab while signed in.' };
  if (!process.env.QBO_CLIENT_ID) return { statusCode: 500, body: 'QBO_CLIENT_ID is not set in Netlify environment variables.' };
  const store = await blobStore();
  if (!store) return { statusCode: 500, body: 'Netlify Blobs unavailable — add @netlify/blobs to package.json and redeploy.' };
  const state = crypto.randomBytes(16).toString('hex');
  await store.set('oauth_state', JSON.stringify({ state, at: Date.now(), by: gate.user.id }));
  const redirect = siteOrigin(event) + '/api/qbo-callback';
  const url = AUTH_URL + '?' + new URLSearchParams({
    client_id: process.env.QBO_CLIENT_ID,
    response_type: 'code',
    scope: 'com.intuit.quickbooks.accounting',
    redirect_uri: redirect,
    state,
  }).toString();
  return { statusCode: 302, headers: { Location: url, 'Cache-Control': 'no-store' }, body: '' };
};
