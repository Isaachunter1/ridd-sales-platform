// Auth lock with a timeout (per Isaac, Oct 16 — the app hung on a blank page): supabase-js serializes every auth
// call across ALL open tabs with one browser lock and, in this version, waits on it forever. One stuck tab (asleep
// mid token refresh, or busy) held it, so every other tab's sign-in check waited forever. Now a tab waits at most
// 6 seconds for the lock and then goes ahead without it (the session in storage is still valid).
async function _sbAuthLock(name, acquireTimeout, fn) {
  if (typeof navigator === 'undefined' || !navigator.locks || !navigator.locks.request) return await fn();
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 6000);
  try {
    return await navigator.locks.request(name, { mode: 'exclusive', signal: ac.signal }, async () => { clearTimeout(t); return await fn(); });
  } catch (e) {
    clearTimeout(t);
    if (e && e.name === 'AbortError') { console.warn('[auth] another tab is holding the sign-in lock — continuing without it'); return await fn(); }
    throw e;
  }
}
const _sbReal = hasConfig
  ? createClient(CFG.SUPABASE_URL, CFG.SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: true, autoRefreshToken: true, lock: _sbAuthLock } })
  : null;

// ── SANDBOX MODE (admin) ──────────────────────────────────────────────────
// Born from a real incident: rep counts were being edited live while
// partners had the app open and watched the numbers move. Sandbox lets an
// admin work against LIVE data while every write is intercepted client-side
// and dropped — changes render locally (in-memory state updates as normal)
// but never reach Supabase, so nobody else sees a thing. Session-scoped:
// refresh/exit restores live truth. NOTE: this is a safety catch for the
// admin's own hands, not a security boundary — the JWT stays a real admin.
const SANDBOX_KEY = 'ridd_sandbox_mode';
function sandboxOn() { try { return sessionStorage.getItem(SANDBOX_KEY) === '1'; } catch { return false; } }
function sandboxStart() {
  const real = state._realProfile || state.profile;
  if (!real || !isAdminRole(real.role)) return;
  try { sessionStorage.setItem(SANDBOX_KEY, '1'); } catch { /* private mode */ }
  mountApp();
}
function sandboxExit() {
  try { sessionStorage.removeItem(SANDBOX_KEY); } catch { /* ignore */ }
  // Full reload — the cleanest way to throw away every sandboxed in-memory
  // change and re-pull the live truth.
  location.reload();
}
// Chainable no-op that quacks like a Postgrest builder: any method returns
// itself, awaiting resolves { data: [], error: null } so callers' error
// checks pass and their UI proceeds as if the save landed.
function _sandboxBuilder() {
  const p = new Proxy(function () {}, {
    get(_t, prop) {
      if (prop === 'then') return (res, rej) => Promise.resolve({ data: [], error: null, count: 0, status: 200, statusText: 'OK (sandbox)' }).then(res, rej);
      if (prop === 'catch') return () => p;
      if (prop === 'finally') return (f) => { try { f && f(); } catch { /* ignore */ } return p; };
      if (prop === Symbol.toStringTag) return 'SandboxBuilder';
      return () => p;
    },
    apply() { return p; },
  });
  return p;
}
const _SANDBOX_TABLE_WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
// View cache (perf pass, Oct 13): ANY database write marks every cached
// screen stale, so a screen re-attached from the cache can never show data
// from before an edit — even code that patches a record in place. Usage /
// error telemetry is excluded (it writes on every page view).
const _VC_QUIET_TABLES = new Set(['usage_events', 'app_events', 'client_errors']);
function _vcWatchWrites(table, qb) {
  if (_VC_QUIET_TABLES.has(table)) return qb;
  return new Proxy(qb, {
    get(qt, m) {
      const v = qt[m];
      if (_SANDBOX_TABLE_WRITES.has(m) && typeof v === 'function') return (...a) => { window._riddMutRev = (window._riddMutRev || 0) + 1; return v.apply(qt, a); };
      return typeof v === 'function' ? v.bind(qt) : v;
    },
  });
}
const _SANDBOX_STORAGE_WRITES = new Set(['upload', 'update', 'uploadToSignedUrl', 'remove', 'move', 'copy', 'createSignedUploadUrl']);
const supabase = _sbReal && new Proxy(_sbReal, {
  get(t, prop) {
    if (prop === 'from') return (table) => {
      const qb = t.from(table);
      if (!sandboxOn()) return _vcWatchWrites(table, qb);
      return new Proxy(qb, {
        get(qt, m) {
          if (_SANDBOX_TABLE_WRITES.has(m)) return () => _sandboxBuilder();
          const v = qt[m];
          return typeof v === 'function' ? v.bind(qt) : v;
        },
      });
    };
    if (prop === 'rpc') return (...args) => { if (sandboxOn()) return _sandboxBuilder(); window._riddMutRev = (window._riddMutRev || 0) + 1; return t.rpc(...args); };
    if (prop === 'storage') {
      const st = t.storage;
      if (!sandboxOn()) return st;
      return new Proxy(st, {
        get(stt, sp) {
          if (sp === 'from') return (bucket) => {
            const b = stt.from(bucket);
            return new Proxy(b, {
              get(bt, m) {
                if (_SANDBOX_STORAGE_WRITES.has(m)) return async () => ({ data: { path: 'sandbox' }, error: null });
                const v = bt[m];
                return typeof v === 'function' ? v.bind(bt) : v;
              },
            });
          };
          const v = stt[sp];
          return typeof v === 'function' ? v.bind(stt) : v;
        },
      });
    }
    const v = t[prop];
    return typeof v === 'function' ? v.bind(t) : v;
  },
});
// Mutating calls to our Netlify functions (password sets, Slack posts,
// manual sync triggers) are writes too — sandbox swallows them with a fake
// 200. GETs (sync status, spend, version) pass through; the client-error
// logger stays live so sandbox crashes still reach us.
{
  const _realFetch = window.fetch.bind(window);
  window.fetch = (url, opts) => {
    try {
      const u = String(url || '');
      const method = String((opts && opts.method) || 'GET').toUpperCase();
      if (sandboxOn() && method !== 'GET' && /^\/(api|\.netlify)\//.test(u) && !u.startsWith('/api/client-error')) {
        return Promise.resolve(new Response(JSON.stringify({ ok: true, sandbox: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
      }
    } catch { /* fall through to the real fetch */ }
    return _realFetch(url, opts);
  };
}

// Resolve the URL we should bake into Supabase auth emails (invites,
// password resets). When the admin happens to be on localhost the
// browser's origin is unreachable for the rep receiving the email, so
// fall back to the configured production URL. In production we just use
// the current origin — keeps preview deploys self-contained.
function authEmailRedirectUrl() {
  const here = window.location.origin || '';
  const isLocal = here.startsWith('http://localhost') || here.startsWith('http://127.0.0.1');
  if (isLocal && CFG.PUBLIC_URL) return CFG.PUBLIC_URL;
  return here;
}

// Bridge to the admin-set-password Netlify Function. Updating ANOTHER
// user's password requires the Supabase service-role key, which can't
// safely live in the browser — so the function holds it and verifies
// the caller's session JWT belongs to an admin before doing anything.
// Throws on any non-2xx so the call-site's try/catch surfaces the
// error as a toast.
async function callAdminSetPassword(payload) {
  const { data: { session } } = await supabase.auth.getSession();
  const jwt = session?.access_token;
  if (!jwt) throw new Error('Not signed in — cannot set a password');
  const res = await fetch('/api/admin-set-password', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization:  'Bearer ' + jwt,
    },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || ('admin-set-password returned ' + res.status));
    err.body = body;   // structured fields (e.g. existing_user_id on a 409) ride along
    throw err;
  }
  return body;
}


