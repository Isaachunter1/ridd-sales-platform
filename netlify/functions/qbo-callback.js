// Second half of the QuickBooks connect: Intuit redirects here with ?code=
// &state=&realmId=. Verify the state we issued, swap the code for tokens,
// persist refresh_token + realm_id in Netlify Blobs, bounce back to the app.
const OAUTH_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer';

async function blobStore() {
  try { const { getStore } = await import('@netlify/blobs'); return getStore('qbo'); } catch { return null; }
}
function siteOrigin(event) {
  const h = event.headers || {};
  const proto = h['x-forwarded-proto'] || 'https';
  const host = h['x-forwarded-host'] || h.host;
  return process.env.URL || `${proto}://${host}`;
}
const back = (origin, status, msg) => ({
  statusCode: 302,
  headers: { Location: origin + '/?qbo=' + status + (msg ? '&msg=' + encodeURIComponent(msg) : '') + '#marketing', 'Cache-Control': 'no-store' },
  body: '',
});
exports.handler = async (event) => {
  const origin = siteOrigin(event);
  const q = (event && event.queryStringParameters) || {};
  const store = await blobStore();
  if (!store) return back(origin, 'error', 'Netlify Blobs unavailable');
  if (q.error) return back(origin, 'error', q.error_description || q.error);
  let issued = null;
  try { issued = JSON.parse((await store.get('oauth_state')) || 'null'); } catch {}
  if (!issued || !q.state || issued.state !== q.state || Date.now() - issued.at > 15 * 60 * 1000) {
    return back(origin, 'error', 'Connect link expired or did not match — try again from the Marketing tab.');
  }
  if (!q.code || !q.realmId) return back(origin, 'error', 'Intuit did not return a code / company id.');
  try {
    const basic = Buffer.from(`${process.env.QBO_CLIENT_ID}:${process.env.QBO_CLIENT_SECRET}`).toString('base64');
    const body = new URLSearchParams({ grant_type: 'authorization_code', code: q.code, redirect_uri: origin + '/api/qbo-callback' }).toString();
    const r = await fetch(OAUTH_URL, { method: 'POST', headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' }, body });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch {}
    if (!r.ok || !json || !json.refresh_token) return back(origin, 'error', 'Token exchange failed: ' + text.slice(0, 160));
    await store.set('refresh_token', json.refresh_token);
    await store.set('realm_id', String(q.realmId));
    await store.set('connected_at', new Date().toISOString());
    await store.delete('oauth_state').catch(() => {});
    return back(origin, 'connected');
  } catch (e) {
    return back(origin, 'error', String(e && e.message || e).slice(0, 160));
  }
};
