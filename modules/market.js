// modules/market.js — riddmarket, plugged into the RIDD Sales Platform shell.
//
// This file is the ONLY place riddmarket's UI lives. It never edits app.js;
// it registers through window.registerRiddModule and gets a ctx with the
// shared Supabase client, the signed-in profile, and the el() builder.
// Database: schema `market` (see market_schema.sql). Rules: CONTRIBUTING-MODULES.md.
(function () {
  const MOD = 'market';

  // Local state for this module lives under ctx.store[MOD] (survives re-renders).
  const S = (ctx) => (ctx.store[MOD] = ctx.store[MOD] || { listings: null, loading: false, error: null });

  async function load(ctx) {
    const st = S(ctx);
    if (st.loading) return;
    st.loading = true; st.error = null; ctx.mountApp();
    try {
      const { data, error } = await ctx.supabase.schema('market').from('listings').select('*').order('created_at', { ascending: false }).limit(200);
      if (error) throw error;
      st.listings = data || [];
    } catch (e) { st.error = (e && e.message) || String(e); st.listings = st.listings || []; }
    st.loading = false; ctx.mountApp();
  }

  window.registerRiddModule({
    id: MOD,
    label: 'Market',
    title: 'RIDD Market',
    icon: () => ctx_icon(),
    // Who sees the tab. Every signed-in RIDD user for now; tighten with
    // ctx.isAdmin / ctx.role / ctx.userCan('...') as needed.
    canView: (ctx) => !!ctx.profile,
    onEnter: (ctx) => { if (S(ctx).listings == null) load(ctx); },
    render: (ctx) => {
      const { el } = ctx; const st = S(ctx);
      const wrap = el('div', { class: 'flex flex-col gap-4' });
      wrap.append(el('div', { class: 'card p-4 flex items-center justify-between gap-3 flex-wrap' },
        el('div', {}, el('div', { class: 'text-sm font-bold' }, 'Listings'), el('div', { class: 'text-[11px] text-muted-' }, 'Signed in as ' + ((ctx.profile && (ctx.profile.full_name || ctx.profile.email)) || 'you'))),
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => load(ctx) }, st.loading ? 'Loading…' : '↻ Refresh')));
      if (st.error) wrap.append(el('div', { class: 'card p-4 text-xs', style: { color: '#DC2626' } }, 'Could not load market.listings — ' + st.error + '. Has market_schema.sql been run and `market` added to the exposed schemas?'));
      const rows = st.listings || [];
      wrap.append(el('div', { class: 'card overflow-hidden' },
        !rows.length ? el('div', { class: 'p-8 text-center text-sm text-muted-' }, st.loading ? 'Loading…' : 'No listings yet.')
        : el('table', { class: 'w-full text-xs' },
            el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } },
              el('tr', {}, ...['Title', 'Price', 'Status', 'Posted'].map(h => el('th', { class: 'px-3 py-2 text-left font-semibold' }, h)))),
            el('tbody', {}, ...rows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
              el('td', { class: 'px-3 py-2 font-semibold' }, r.title),
              el('td', { class: 'px-3 py-2 tabular-nums' }, r.price_cents != null ? '$' + (r.price_cents / 100).toFixed(2) : '—'),
              el('td', { class: 'px-3 py-2' }, r.status),
              el('td', { class: 'px-3 py-2' }, new Date(r.created_at).toLocaleDateString())))))));
      return wrap;
    },
  });

  function ctx_icon() {
    const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', '16'); s.setAttribute('height', '16'); s.setAttribute('fill', 'none'); s.setAttribute('stroke', 'currentColor'); s.setAttribute('stroke-width', '2');
    s.innerHTML = '<path d="M3 9l1-5h16l1 5M3 9v11h18V9M3 9h18M9 20v-6h6v6"/>';
    return s;
  }
})();
