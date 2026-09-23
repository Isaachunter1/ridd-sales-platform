// ── Integrations (per Isaac, Sep 23 — the app is being built to be sold) ──
// Every external system the app talks to is configured from Settings → Data
// sources instead of Netlify env vars, so a new company can be onboarded from
// inside the product. Secrets live in public.integrations (service role only;
// admins see a masked view). Env vars remain a fallback so RIDD's existing
// setup keeps working untouched.
//
//   loadIntegration(admin, 'fieldroutes') → { config, secrets, status } | null
//   applyFieldRoutesEnv(admin)            → fills process.env.FIELDROUTES_* from the
//                                           saved integration (DB wins over env)
//   recordIntegrationStatus(admin, id, patch) → merges into status jsonb
async function loadIntegration(admin, id) {
  try {
    const { data, error } = await admin.from('integrations').select('id, config, secrets, status').eq('id', id).maybeSingle();
    if (error || !data) return null;
    return data;
  } catch (e) { return null; }
}
async function applyFieldRoutesEnv(admin) {
  const row = await loadIntegration(admin, 'fieldroutes');
  const cfg = (row && row.config) || {}, sec = (row && row.secrets) || {};
  if (row && cfg.enabled === false) { process.env.FIELDROUTES_AUTH_KEY = ''; process.env.FIELDROUTES_AUTH_TOKEN = ''; return { enabled: false }; }
  if (cfg.subdomain) process.env.FIELDROUTES_SUBDOMAIN = String(cfg.subdomain).trim();
  if (cfg.domain) process.env.FIELDROUTES_DOMAIN = String(cfg.domain).trim();
  if (sec.auth_key) process.env.FIELDROUTES_AUTH_KEY = String(sec.auth_key).trim();
  if (sec.auth_token) process.env.FIELDROUTES_AUTH_TOKEN = String(sec.auth_token).trim();
  return { enabled: !!(process.env.FIELDROUTES_SUBDOMAIN && process.env.FIELDROUTES_AUTH_KEY && process.env.FIELDROUTES_AUTH_TOKEN), fromDb: !!row };
}
// Base URL: pestroutes.com by default; some accounts log in at *.fieldroutes.com.
function fieldRoutesBase() {
  const sub = (process.env.FIELDROUTES_SUBDOMAIN || '').trim();
  const dom = (process.env.FIELDROUTES_DOMAIN || 'pestroutes.com').replace(/^https?:\/\//, '').replace(/\/.*$/, '').trim() || 'pestroutes.com';
  return sub ? 'https://' + sub + '.' + dom + '/api/' : null;
}
async function recordIntegrationStatus(admin, id, patch) {
  try {
    const row = await loadIntegration(admin, id);
    const status = Object.assign({}, (row && row.status) || {}, patch, { updated_at: new Date().toISOString() });
    if (row) await admin.from('integrations').update({ status }).eq('id', id);
  } catch (e) { /* best effort */ }
}
module.exports = { loadIntegration, applyFieldRoutesEnv, fieldRoutesBase, recordIntegrationStatus };
