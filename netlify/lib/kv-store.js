// Tiny server-side key/value cache on public.app_settings (jsonb) using the
// service-role key. Netlify Blobs isn't provisioned for this site's legacy
// function runtime, so cached feeds (QuickBooks spend via Windsor) live here.
const { createClient } = require('@supabase/supabase-js');
function client() {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}
function kvStore(prefix) {
  const sb = client();
  if (!sb) return null;
  const k = (name) => prefix + ':' + name;
  return {
    async get(name) {
      const { data, error } = await sb.from('app_settings').select('value').eq('key', k(name)).maybeSingle();
      if (error) throw new Error(error.message);
      return data ? data.value : null;
    },
    async set(name, value) {
      const { error } = await sb.from('app_settings').upsert({ key: k(name), value, updated_at: new Date().toISOString() }, { onConflict: 'key' });
      if (error) throw new Error(error.message);
    },
    async delete(name) {
      const { error } = await sb.from('app_settings').delete().eq('key', k(name));
      if (error) throw new Error(error.message);
    },
  };
}
module.exports = { kvStore };
