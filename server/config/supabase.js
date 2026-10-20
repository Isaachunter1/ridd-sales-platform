// Service-role client — bypasses RLS. Only the server and DASHP hold this
// key. Jobs and privileged endpoints import this; nothing else.
import { createClient } from '@supabase/supabase-js';
import env from './env.js';

// Placeholders keep the module importable while the service is not yet
// configured (index.js answers 503 everywhere but /healthz in that state).
const URL_ = env.SUPABASE_URL || 'http://not-configured.invalid';
const SERVICE_ = env.SUPABASE_SERVICE_ROLE_KEY || 'not-configured';
const ANON_ = env.SUPABASE_ANON_KEY || 'not-configured';

export const supabase = createClient(URL_, SERVICE_, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Anon client used ONLY to verify a user's JWT (auth.getUser). Never for data.
export const supabaseAnon = createClient(URL_, ANON_, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// Supabase/PostgREST caps a select at 1,000 rows. Every multi-row read goes
// through this so nothing past row 1,000 is silently skipped (Oct 15 — 1,442
// sales in the verify window, only the first 1,000 were read). Ported as-is.
export async function selectAll(make, orderCol = 'id') {
  const out = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await make().order(orderCol).range(from, from + 999);
    if (error) return { data: null, error };
    out.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return { data: out, error: null };
}
