// Tiny server-side key/value cache on public.app_settings (jsonb) using the
// service-role key. Netlify Blobs isn't provisioned for this site's legacy
// function runtime, so cached feeds (QuickBooks spend via Windsor) live here.
const { createClient } = require('@supabase/supabase-js');
function client() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
// Prefers public.server_cache (service-role only — run server_cache.sql);
// falls back to app_settings (readable by every signed-in user) until that
// table exists.
let _table = null;
async function table(sb) {
  if (_table) return _table;
  const { error } = await sb.from('server_cache').select('key').limit(1);
  _table = error ? 'app_settings' : 'server_cache';
  if (error) console.warn('[kv-store] server_cache missing (run server_cache.sql) — using app_settings');
  return _table;
}
function kvStore(prefix) {
  const sb = client();
  if (!sb) return null;
  const k = (name) => prefix + ':' + name;
  return {
    async get(name) {
      const t = await table(sb);
      const { data, error } = await sb.from(t).select('value').eq('key', k(name)).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? data.value : null;
    },
    async set(name, value) {
      const t = await table(sb);
      const { error } = await sb.from(t).upsert({ key: k(name), value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    async delete(name) {
      const t = await table(sb);
      const { error } = await sb.from(t).delete().eq('key', k(name));
      if (error) throw new Error(error.message);
    },
  };
}
module.exports = { kvStore };
