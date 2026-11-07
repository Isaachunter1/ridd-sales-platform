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
// Every office the key can read (per Isaac, Oct 13). FieldRoutes answers a search for the key's HOME office only unless
// officeIDs is passed: the live pull saw 5 subscriptions since Oct 11 while FieldRoutes had ~170, and the deleted-
// customer scan rejected 376/377 batches as ">10% missing". Workers call this once and their fr() adds officeIDs
// to every call (office/* endpoints excepted). Empty on failure — calls then behave exactly as before.
async function frOfficeIds(frFn) {
  try { const j = await frFn('office/search', {}); return (Array.isArray(j.officeIDs) ? j.officeIDs : Object.values(j.officeIDs || {})).map(Number).filter(n => n > 0); }
  catch (e) { console.warn('[fieldroutes] office/search failed:', e && e.message); return []; }
}
// Office ids + names, cached for a day in app_settings.fr_office_cache (per Isaac, Oct 28 — FieldRoutes asked us to
// cache what rarely changes; the live pull and add-ons sync each read office/search + office/get on every run,
// ~800 calls a day for a list that changes when a branch opens). Cached only when BOTH calls succeed, so a bad
// read never sticks for a day. Ids and branch names only — app_settings is readable company-wide.
const OFFICE_CACHE_MS = 24 * 3600 * 1000;
async function frOfficesCached(admin, frFn) {
  try {
    const { data } = await admin.from('app_settings').select('value').eq('key', 'fr_office_cache').maybeSingle();
    const v = data && data.value;
    if (v && Array.isArray(v.ids) && v.ids.length && Array.isArray(v.offices) && v.offices.length && Date.now() - Date.parse(v.at) < OFFICE_CACHE_MS) return { ids: v.ids, offices: v.offices, cached: true };
  } catch (e) { /* read fresh */ }
  const ids = await frOfficeIds(frFn);
  let offices = [];
  try {
    const og = await frFn('office/get', {});
    offices = (Array.isArray(og.offices) ? og.offices : Object.values(og.offices || {})).map(o => ({ officeID: String(o.officeID), officeName: String(o.officeName || '') }));
  } catch (e) { console.warn('[fieldroutes] office/get failed:', e && e.message); }
  if (ids.length && offices.length) {
    try { await admin.from('app_settings').upsert({ key: 'fr_office_cache', value: { at: new Date().toISOString(), ids, offices } }, { onConflict: 'key' }); } catch (e) { /* next run retries */ }
  }
  return { ids, offices, cached: false };
}
// Rate limits (per Isaac, Oct 28): when FieldRoutes says "too many requests" the run STOPS — no retries, no more
// calls. Retrying while limited only deepens the limit for every other job. The next scheduled run picks up where
// this one left off (every job here is idempotent).
const isRateLimited = (status, txt) => status === 429 || /too many requests|rate limit/i.test(String(txt || '').slice(0, 300));
class FieldRoutesRateLimited extends Error { constructor(endpoint) { super('FieldRoutes rate limit on ' + endpoint + ' — run stopped, next run resumes'); this.rateLimited = true; } }
module.exports = { loadIntegration, applyFieldRoutesEnv, fieldRoutesBase, recordIntegrationStatus, frOfficeIds, frOfficesCached, isRateLimited, FieldRoutesRateLimited };
