// Settings → Data sources: save / test an integration. Admin JWT required.
//   POST /api/integrations-admin  { id, action: 'save'|'test'|'disable', config?, secrets? }
// Secrets are write-only from the browser: a blank secret field means "keep".
const { createClient } = require('@supabase/supabase-js');
const { loadIntegration, applyFieldRoutesEnv, fieldRoutesBase } = require('../lib/integrations.js');
const json = (statusCode, body) => ({ statusCode, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }, body: JSON.stringify(body) });

exports.handler = async (event) => {
  if (event.httpMethod !== 'POST') return json(405, { error: 'POST only' });
  const SUPABASE_URL = process.env.SUPABASE_URL, SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY, ANON_KEY = process.env.SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SERVICE_KEY || !ANON_KEY) return json(500, { error: 'Server missing Supabase env' });
  const jwt = (event.headers.authorization || event.headers.Authorization || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json(401, { error: 'Sign in required' });
  const { data: userRes, error: userErr } = await createClient(SUPABASE_URL, ANON_KEY).auth.getUser(jwt);
  if (userErr || !userRes || !userRes.user) return json(401, { error: 'Invalid session' });
  const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
  const { data: prof } = await admin.from('profiles').select('role').eq('id', userRes.user.id).maybeSingle();
  if (!prof || !['admin', 'admin_rep'].includes(prof.role)) return json(403, { error: 'Admins only' });

  let body; try { body = JSON.parse(event.body || '{}'); } catch (e) { return json(400, { error: 'bad json' }); }
  const id = String(body.id || '').trim();
  if (!['fieldroutes', 'revhawk'].includes(id)) return json(400, { error: 'unknown integration' });
  const action = String(body.action || 'save');
  const existing = await loadIntegration(admin, id);
  const config = Object.assign({}, (existing && existing.config) || {}, body.config || {});
  const secrets = Object.assign({}, (existing && existing.secrets) || {});
  for (const [k, v] of Object.entries(body.secrets || {})) if (v != null && String(v).trim() !== '') secrets[k] = String(v).trim();
  if (action === 'disable') config.enabled = false;
  if (action === 'save' || action === 'disable') {
    const { error } = await admin.from('integrations').upsert({ id, config, secrets, updated_by: userRes.user.id, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) return json(500, { error: error.message });
  }
  if (action === 'test' || action === 'save') {
    // Test what is saved (+ what was just sent), never what the browser thinks it has.
    let result = { ok: false, message: 'no test for this source' };
    if (id === 'fieldroutes') {
      const dom = String(config.domain || 'pestroutes.com'), sub = String(config.subdomain || '').trim();
      const key = secrets.auth_key || '', tok = secrets.auth_token || '';
      if (!sub || !key || !tok) result = { ok: false, message: 'Subdomain, key and token are all required' };
      else {
        try {
          const q = new URLSearchParams({ authenticationKey: key, authenticationToken: tok });
          const res = await fetch('https://' + sub + '.' + dom + '/api/office/get?' + q.toString());
          const txt = await res.text(); let j = null; try { j = JSON.parse(txt); } catch (e) { /* html error page */ }
          if (!j) result = { ok: false, message: 'Not a FieldRoutes API response (HTTP ' + res.status + ') — check the subdomain' };
          else if (j.success === false || (j.errorMessage && j.errorMessage !== '')) result = { ok: false, message: j.errorMessage || 'FieldRoutes rejected the key' };
          else { const n = Array.isArray(j.offices) ? j.offices.length : (j.officeIDs ? j.officeIDs.length : null); result = { ok: true, message: 'Connected' + (n != null ? ' · ' + n + ' office' + (n === 1 ? '' : 's') + ' visible' : ''), offices: n }; }
        } catch (e) { result = { ok: false, message: String((e && e.message) || e) }; }
      }
    }
    if (id === 'revhawk') {
      result = (process.env.GCP_SA_EMAIL && (process.env.GCP_SA_PRIVATE_KEY || process.env.GCP_SA_JSON)) ? { ok: true, message: 'Service account present in Netlify env' } : { ok: false, message: 'GCP_SA_EMAIL / GCP_SA_PRIVATE_KEY not set in Netlify env' };
    }
    const status = Object.assign({}, (existing && existing.status) || {}, { last_test_at: new Date().toISOString(), last_test_ok: result.ok, last_test_message: result.message });
    await admin.from('integrations').upsert({ id, config, secrets, status, updated_by: userRes.user.id, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    return json(200, { ok: true, test: result });
  }
  return json(200, { ok: true });
};
