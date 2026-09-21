// ┌─ src/74-riddcoin.js ─────────────────────────────────────────────────────
// │ Riddcoin marketplace and ledger.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// ═══════════════════════════════════════════════════════════════════════
// 🪙 RIDDCOIN MARKETPLACE — incentive currency + year-end prize store.
// Users earn RIDDCOIN through comps/incentives (admin grants), spend it in
// the store for prize-pickup at the end of the year. Every movement is an
// append-only ledger row (who, how much, why, granted by whom, when).
// Schema + write rpcs live in riddcoin.sql — run once in Supabase.
// ═══════════════════════════════════════════════════════════════════════
// Returns TRUE only when it actually fetched. Callers that re-render on the
// result MUST honour that — a bare .then(mountApp) on a no-op call re-enters
// the view, which calls back in here, which no-ops again… (see viewMarketplace).
async function loadRiddcoin(force) {
  if (!supabase || !state.profile) return false;
  if (state._rcLoading) return false;
  if (!force && state._rcLoadedAt && Date.now() - state._rcLoadedAt < 60000) return false;
  state._rcLoading = true;
  try {
    const [it, led, profs] = await Promise.all([
      supabase.from('riddcoin_items').select('*').order('sort').order('created_at'),
      supabase.from('riddcoin_ledger').select('*').order('created_at', { ascending: false }).limit(2000),
      supabase.from('profiles').select('id, full_name, role'),
    ]);
    state._rcErr = (it.error && it.error.message) || (led.error && led.error.message) || null;
    if (!it.error)  state._rcItems  = it.data || [];
    if (!led.error) state._rcLedger = led.data || [];
    if (!profs.error) { state._rcNames = {}; (profs.data || []).forEach(pr => { state._rcNames[pr.id] = pr.full_name || '—'; }); }
  } catch (e) { state._rcErr = String((e && e.message) || e); }
  finally {
    // Stamp in `finally`: a THROWN fetch used to leave _rcLoadedAt unset, so
    // the 60s throttle never engaged and the view re-fetched forever.
    state._rcLoadedAt = Date.now();
    state._rcLoading = false;
  }
  return true;
}
function _rcBalanceOf(userId) {
  return (state._rcLedger || []).filter(r => r.user_id === userId).reduce((a, r) => a + (Number(r.delta) || 0), 0);
}
const _rcCoin = (n) => Number(n || 0).toLocaleString('en-US') + ' ¤'; // ¤ = RIDDCOIN mark
// Item metadata lives in description as JSON: {"text":"…","photos":[urls…]}
// for store items, {"spin":true,"pool":[…]} for spins. Legacy plain-text
// descriptions parse as {text}. One parser for everything.
function _rcMeta(i) {
  try {
    const j = JSON.parse((i && i.description) || '');
    if (j && typeof j === 'object') {
      return { text: String(j.text || ''), photos: Array.isArray(j.photos) ? j.photos : [], spin: !!j.spin, pool: Array.isArray(j.pool) ? j.pool : [] };
    }
  } catch { /* legacy plain text */ }
  return { text: (i && i.description) || '', photos: [], spin: false, pool: [] };
}
function _rcSpinCfg(i) {
  const m = _rcMeta(i);
  return (m.spin && m.pool.length) ? m : null;
}
// Shared redeem flow (store card + product page). Returns true on success.
async function _rcRedeem(i) {
  if (!confirm('Redeem "' + i.name + '" for ' + _rcCoin(i.cost) + '? This spends your RIDDCOIN and reserves the prize for year-end pickup.')) return false;
  const { error } = await supabase.rpc('riddcoin_spend', { p_item: i.id });
  if (error) { toast('Redeem failed: ' + error.message, 'error'); return false; }
  toast('🎉 ' + i.name + ' reserved — see you at prize pickup!', 'success');
  await loadRiddcoin(true); mountApp();
  return true;
}
// Multi-photo upload to the public 'riddcoin' bucket (riddcoin_storage.sql).
async function _rcUploadPhotos(files) {
  const urls = [];
  for (const f of files) {
    const path = 'items/' + Date.now() + '-' + Math.random().toString(36).slice(2, 8) + '-' + String(f.name || 'photo').replace(/[^\w.\-]+/g, '_');
    const { error } = await supabase.storage.from('riddcoin').upload(path, f, { contentType: f.type || 'image/jpeg' });
    if (error) { toast('Photo upload failed: ' + error.message, 'error'); continue; }
    const { data } = supabase.storage.from('riddcoin').getPublicUrl(path);
    if (data && data.publicUrl) urls.push(data.publicUrl);
  }
  return urls;
}
// 🛍️ PRODUCT PAGE — the Shopify-style detail view: photo gallery with
// thumbnail switcher, description, price, stock, Redeem.
function openRcItemModal(i) {
  const meta = _rcMeta(i);
  const myBal = _rcBalanceOf(state.profile.id);
  const out = i.stock != null && i.stock <= 0;
  const cant = myBal < i.cost;
  let idx = 0;
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  const mainImg = el('div', { style: { width: '100%', aspectRatio: '1 / 1', borderRadius: '0', background: 'var(--card-2)', overflow: 'hidden', display: 'flex', alignItems: 'center', justifyContent: 'center' } });
  const thumbsRow = el('div', { class: 'flex items-center gap-1.5 mt-2 flex-wrap' });
  const renderGallery = () => {
    mainImg.innerHTML = '';
    if (meta.photos.length) mainImg.append(el('img', { src: meta.photos[idx], alt: i.name, style: { width: '100%', height: '100%', objectFit: 'cover' } }));
    else mainImg.append(el('div', { class: 'text-6xl' }, '🎁'));
    thumbsRow.innerHTML = '';
    if (meta.photos.length > 1) meta.photos.forEach((u, j) => thumbsRow.append(el('img', {
      src: u, alt: '',
      class: 'cursor-pointer',
      style: { width: '52px', height: '52px', objectFit: 'cover', borderRadius: '0', border: j === idx ? '2px solid var(--accent)' : '2px solid var(--border-2)', opacity: j === idx ? '1' : '.7' },
      onclick: () => { idx = j; renderGallery(); },
    })));
  };
  renderGallery();
  overlay.append(el('div', { class: 'card p-5 w-full', style: { maxWidth: '720px' } },
    el('div', { class: 'flex items-center justify-end mb-1' },
      el('button', { class: 'text-xl leading-none cursor-pointer px-2', onclick: () => overlay.remove() }, '×')),
    el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 gap-4' },
      el('div', {}, mainImg, thumbsRow),
      el('div', { class: 'flex flex-col' },
        el('div', { class: 'font-display text-2xl leading-tight' }, i.name),
        el('div', { class: 'font-black tabular-nums text-xl mt-1', style: { color: '#DF643A' } }, _rcCoin(i.cost)),
        i.stock != null ? el('div', { class: 'text-xs mt-0.5', style: { color: out ? '#DC2626' : 'var(--text-muted)' } }, out ? 'Out of stock' : i.stock + ' left in stock') : null,
        meta.text ? el('p', { class: 'text-sm mt-3', style: { color: 'var(--text-muted)', lineHeight: '1.55' } }, meta.text) : null,
        el('button', {
          class: 'w-full rounded-xl px-2.5 py-1 text-[11px] font-bold mt-auto' + ((out || cant) ? ' opacity-50' : ' cursor-pointer hover:brightness-95'),
          style: { background: 'var(--accent)', color: 'var(--accent-text)', marginTop: 'auto' },
          disabled: (out || cant) ? 'disabled' : null,
          title: out ? 'Out of stock' : cant ? 'Not enough RIDDCOIN (you have ' + _rcCoin(myBal) + ')' : '',
          onclick: (out || cant) ? null : (async () => { if (await _rcRedeem(i)) overlay.remove(); }),
        }, cant && !out ? 'Need ' + _rcCoin(i.cost - myBal) + ' more' : 'Redeem — ' + _rcCoin(i.cost))))));
  document.body.append(overlay);
}
// Admin drill: one user's full RIDDCOIN history in a modal (opened from the
// Balances tab rows).
function openRcUserHistory(uid) {
  const names = state._rcNames || {};
  const rows = (state._rcLedger || []).filter(r => r.user_id === uid);
  const bal = rows.reduce((a2, r) => a2 + (Number(r.delta) || 0), 0);
  const overlay = el('div', { class: 'modal-overlay' });
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove(); });
  overlay.append(el('div', { class: 'card p-5 w-full', style: { maxWidth: '640px' } },
    el('div', { class: 'flex items-center justify-between gap-3 mb-3' },
      el('div', {},
        el('h3', { class: 'text-base font-bold' }, names[uid] || 'User'),
        el('div', { class: 'text-xs text-muted-' }, rows.length + ' ledger entr' + (rows.length === 1 ? 'y' : 'ies') + ' · balance ',
          el('span', { class: 'font-black tabular-nums', style: { color: bal >= 0 ? '#DF643A' : '#B91C1C' } }, _rcCoin(bal)))),
      el('button', { class: 'text-xl leading-none cursor-pointer px-2', onclick: () => overlay.remove() }, '×')),
    el('div', { style: { maxHeight: '62vh', overflowY: 'auto' } },
      el('table', { class: 'w-full text-xs' },
        el('tbody', {},
          rows.length === 0 ? el('tr', {}, el('td', { class: 'py-6 text-center text-muted-' }, 'No RIDDCOIN activity yet.')) : null,
          ...rows.map(r => el('tr', { class: 'border-t border-' },
            el('td', { class: 'py-1.5 pr-2 whitespace-nowrap text-muted- tabular-nums' }, _rcWhen(r.created_at)),
            el('td', { class: 'py-1.5 pr-2 text-right tabular-nums font-black', style: { color: r.delta > 0 ? '#DF643A' : '#B91C1C' } }, (r.delta > 0 ? '+' : '') + _rcCoin(r.delta)),
            el('td', { class: 'py-1.5 pr-2' }, r.reason || '—'),
            el('td', { class: 'py-1.5 text-muted- whitespace-nowrap' }, names[r.created_by] || '—'))))))));
  document.body.append(overlay);
}
function _rcWhen(ts) {
  const d = new Date(ts);
  return isNaN(d) ? '' : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
    + ' ' + d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}
function viewMarketplace() {
  const isAdmin = isAdminRole(state.profile?.role);
  // First entry (or stale): pull fresh data, re-render when it lands.
  if (!state._rcLoading && (!state._rcLoadedAt || Date.now() - state._rcLoadedAt > 60000)) {
    loadRiddcoin().then((fetched) => { if (fetched && state.view === 'marketplace') mountApp(); });
  }
  const wrap = el('div', { class: 'flex flex-col gap-4 w-full' });
  const myBal = _rcBalanceOf(state.profile.id);

  // ── Hero: brand + own balance ──
  wrap.append(el('div', { class: 'card p-5 flex items-center justify-between gap-4 flex-wrap', style: { background: 'var(--text)', color: 'var(--bg)' } },
    el('div', {},
      el('div', { class: 'text-[9px] font-black', style: { letterSpacing: '.25em', opacity: '.85' } }, 'RIDDMADE®'),
      el('div', { class: 'font-display text-3xl leading-none' }, 'MARKETPLACE'),
      el('div', { class: 'text-xs mt-1', style: { opacity: '.7' } }, 'Earn RIDDCOIN all season · spend it at year-end prize pickup')),
    el('div', { class: 'text-right' },
      el('div', { class: 'text-[9px] font-black uppercase', style: { letterSpacing: '.18em', opacity: '.6' } }, 'Your RIDDCOIN'),
      el('div', { class: 'font-display text-4xl leading-none tabular-nums', style: { color: '#DF643A' } }, _rcCoin(myBal)))));

  // Schema not installed yet → setup card (the localhost model shows this
  // until riddcoin.sql is run once in the Supabase SQL Editor).
  if (state._rcErr && /riddcoin|relation|does not exist|schema cache/i.test(state._rcErr)) {
    wrap.append(el('div', { class: 'card p-8 text-center' },
      el('div', { class: 'text-3xl mb-2' }, '🪙'),
      el('h3', { class: 'text-base font-bold mb-1' }, 'One-time setup'),
      el('p', { class: 'text-xs text-muted- max-w-md mx-auto' },
        'Run riddcoin.sql (repo root) in the Supabase SQL Editor to create the ledger, the catalog, and the secure grant/spend functions — then reload this tab.'),
      el('p', { class: 'text-[10px] text-muted- mt-2' }, state._rcErr)));
    return wrap;
  }

  // ── Tabs ──
  const TABS = isAdmin
    ? [['store', '🛒 Store'], ['history', '📜 My History'], ['balances', '💰 Balances'], ['ledger', '🗃️ Full Ledger'], ['manage', '⚙️ Manage']]
    : [['store', '🛒 Store'], ['history', '📜 My History']];
  const tab = TABS.some(([k]) => k === state._rcTab) ? state._rcTab : 'store';
  wrap.append(el('div', { class: 'flex items-center gap-1.5 flex-wrap' },
    ...TABS.map(([k, l]) => el('button', {
      class: 'px-2.5 py-1 rounded-xl text-[11px] font-bold border transition hover:brightness-95',
      style: k === tab ? { background: 'var(--text)', color: 'var(--bg)', borderColor: 'var(--text)' }
                       : { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
      onclick: () => { state._rcTab = k; mountApp(); },
    }, l))));

  const names = state._rcNames || {};
  const items = state._rcItems || [];
  const ledger = state._rcLedger || [];

  // ── STORE ──
  if (tab === 'store') {
    const live = items.filter(i => i.active);
    wrap.append(live.length === 0
      ? el('div', { class: 'card p-8 text-center text-xs text-muted-' },
          state._rcLoading ? 'Loading the store…' : 'No prizes in the store yet' + (isAdmin ? ' — add some under ⚙️ Manage.' : ' — check back soon.'))
      : el('div', { class: 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4' },
          ...live.map(i => {
            const out = i.stock != null && i.stock <= 0;
            const cant = myBal < i.cost;
            const spin = _rcSpinCfg(i);
            if (spin) {
              const oddsTitle = spin.pool.map(p2 => p2.name + ' · ' + (Number(p2.odds) || 0) + '%' + (Number(p2.value) > 0 ? ' · worth ' + _rcCoin(p2.value) : '')).join('\n');
              return el('div', { class: 'card p-4 flex flex-col gap-2', style: { borderColor: '#DF643A' } },
                el('div', { class: 'text-3xl' }, '🎰'),
                el('div', { class: 'font-bold text-sm leading-tight' }, i.name),
                el('div', { class: 'text-[11px] text-muted-', title: oddsTitle }, spin.pool.length + ' possible prizes — hover to peek the odds'),
                el('div', { class: 'flex items-center justify-between mt-auto pt-2' },
                  el('div', {},
                    el('div', { class: 'font-black tabular-nums', style: { color: '#DF643A' } }, _rcCoin(i.cost)),
                    i.stock != null ? el('div', { class: 'text-[10px] text-muted-' }, out ? 'Out of stock' : i.stock + ' left') : null),
                  el('button', {
                    class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold' + ((out || cant) ? ' opacity-50' : ' cursor-pointer hover:brightness-95'),
                    style: { background: 'var(--text)', color: 'var(--bg)' },
                    disabled: (out || cant) ? 'disabled' : null,
                    title: out ? 'Out of stock' : cant ? 'Not enough RIDDCOIN (you have ' + _rcCoin(myBal) + ')' : 'One spin · prize rolled by the odds',
                    onclick: (out || cant) ? null : (async () => {
                      if (!confirm('Spend ' + _rcCoin(i.cost) + ' on one "' + i.name + '"? The prize is rolled by the odds — whatever the box reveals is yours at prize pickup.')) return;
                      const { data: prize, error } = await supabase.rpc('riddcoin_spin', { p_item: i.id });
                      if (error) { toast('Spin failed: ' + error.message, 'error'); return; }
                      const won = String(prize || '');
                      const entry = spin.pool.find(p2 => p2.name === won);
                      if (entry && entry.rarity) state._mbRarity = { ...(state._mbRarity || {}), [won]: entry.rarity };
                      loadRiddcoin(true);
                      // The full icybox experience: carousel of boxes, pick
                      // one, it opens on the SERVER-rolled prize.
                      if (typeof openMysteryBoxOverlay === 'function' && typeof _mbEnc === 'function') {
                        openMysteryBoxOverlay({ id: '__rcspin__', prize: _mbEnc(won) });
                      } else toast('🎁 You won: ' + won + '!', 'success');
                    }),
                  }, '🎰 Spin')));
            }
            // Shopify-style product card — lead photo, click anywhere for
            // the product page (gallery + description + redeem).
            const meta = _rcMeta(i);
            return el('div', {
              class: 'card p-4 flex flex-col gap-2 cursor-pointer transition hover:brightness-95',
              title: 'View ' + i.name,
              onclick: () => openRcItemModal(i),
            },
              meta.photos.length
                ? el('div', { style: { width: '100%', aspectRatio: '1 / 1', borderRadius: '0', overflow: 'hidden', background: 'var(--card-2)' } },
                    el('img', { src: meta.photos[0], alt: i.name, style: { width: '100%', height: '100%', objectFit: 'cover' } }))
                : el('div', { class: 'text-3xl' }, '🎁'),
              el('div', { class: 'font-bold text-sm leading-tight' }, i.name),
              meta.text ? el('div', { class: 'text-[11px] text-muted-', style: { display: '-webkit-box', WebkitLineClamp: '2', WebkitBoxOrient: 'vertical', overflow: 'hidden' } }, meta.text) : null,
              el('div', { class: 'flex items-center justify-between mt-auto pt-2' },
                el('div', {},
                  el('div', { class: 'font-black tabular-nums', style: { color: '#DF643A' } }, _rcCoin(i.cost)),
                  i.stock != null ? el('div', { class: 'text-[10px] text-muted-' }, out ? 'Out of stock' : i.stock + ' left') : null),
                el('button', {
                  class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold' + ((out || cant) ? ' opacity-50' : ' cursor-pointer hover:brightness-95'),
                  style: { background: 'var(--accent)', color: 'var(--accent-text)' },
                  disabled: (out || cant) ? 'disabled' : null,
                  title: out ? 'Out of stock' : cant ? 'Not enough RIDDCOIN (you have ' + _rcCoin(myBal) + ')' : 'Redeem for ' + _rcCoin(i.cost),
                  onclick: (out || cant) ? null : (async (e) => { e.stopPropagation(); await _rcRedeem(i); }),
                }, 'Redeem')));
          })));
  }

  // ── Shared ledger table renderer ──
  // Sell-back eligibility (per Isaac): a spin WINNING (not yet sold back,
  // with a Value on its pool entry) can be traded back for 90% of value —
  // so reps can keep spinning for the prize they actually want. The rpc
  // (riddcoin_sellback.sql) re-verifies everything server-side.
  const _refunded = new Set(ledger.filter(r => r.ref_id).map(r => String(r.ref_id)));
  const _sellInfo = (r) => {
    if (r.kind !== 'spend' || !/^Spin: /.test(String(r.reason || '')) || _refunded.has(String(r.id))) return null;
    const it = items.find(x => x.id === r.item_id);
    if (!it) return null;
    const m = _rcMeta(it);
    const prize = String(r.reason).split(' \u2192 ')[1] || '';
    const e2 = m.pool.find(p2 => p2.name === prize);
    const v = (e2 && Number(e2.value)) || 0;
    return v > 0 ? { payout: Math.floor(v * 0.9), prize, value: v } : null;
  };
  const ledgerTable = (rows, showUser, canSell) => el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'overflow-x-auto' }, el('table', { class: 'w-full text-xs' },
      el('thead', {}, el('tr', { class: 'text-left text-[9px] uppercase tracking-widest text-muted-' },
        el('th', { class: 'px-3 py-2' }, 'When'),
        showUser ? el('th', { class: 'px-3 py-2' }, 'User') : null,
        el('th', { class: 'px-3 py-2 text-right' }, 'Δ RIDDCOIN'),
        el('th', { class: 'px-3 py-2 hidden sm:table-cell' }, 'Type'),
        el('th', { class: 'px-3 py-2' }, 'Reason'),
        el('th', { class: 'px-3 py-2 hidden sm:table-cell' }, 'By'),
        canSell ? el('th', { class: 'px-3 py-2' }, '') : null)),
      el('tbody', {},
        rows.length === 0 ? el('tr', {}, el('td', { colspan: '6', class: 'px-3 py-6 text-center text-muted-' }, 'No RIDDCOIN activity yet.')) : null,
        ...rows.map(r => el('tr', { class: 'border-t border-' },
          el('td', { class: 'px-3 py-2 whitespace-nowrap text-muted- tabular-nums' }, _rcWhen(r.created_at)),
          showUser ? el('td', { class: 'px-3 py-2 font-semibold whitespace-nowrap' }, names[r.user_id] || '—') : null,
          el('td', { class: 'px-3 py-2 text-right tabular-nums font-black', style: { color: r.delta > 0 ? '#DF643A' : '#B91C1C' } }, (r.delta > 0 ? '+' : '') + _rcCoin(r.delta)),
          el('td', { class: 'px-3 py-2 hidden sm:table-cell' },
            el('span', { class: 'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase', style: { background: 'var(--card-2)', color: 'var(--text-muted)' } }, r.kind)),
          el('td', { class: 'px-3 py-2' }, r.reason || '—'),
          el('td', { class: 'px-3 py-2 hidden sm:table-cell text-muted- whitespace-nowrap' }, names[r.created_by] || '—'),
          canSell ? el('td', { class: 'px-3 py-2 text-right whitespace-nowrap' }, (() => {
            const si = _sellInfo(r);
            if (!si) return _refunded.has(String(r.id)) ? el('span', { class: 'text-[10px] font-bold text-muted-' }, 'sold back') : '';
            return el('button', {
              class: 'px-2 py-1 rounded text-[10px] font-bold cursor-pointer border transition hover:brightness-95',
              style: { borderColor: 'rgba(223,100,58,.5)', color: '#DF643A' },
              title: si.prize + ' is worth ' + _rcCoin(si.value) + ' \u2014 sell it back to RIDD for 90% and keep spinning',
              onclick: async () => {
                if (!confirm('Sell "' + si.prize + '" back to RIDD for ' + _rcCoin(si.payout) + ' (90% of its ' + _rcCoin(si.value) + ' value)? The prize goes back to RIDD and the coins hit your balance now.')) return;
                const { data, error } = await supabase.rpc('riddcoin_sellback', { p_ledger: r.id });
                if (error) { toast('Sell-back failed: ' + error.message, 'error'); return; }
                toast('\ud83e\ude99 Sold back for ' + _rcCoin(Number(data) || si.payout) + ' \u2014 happy spinning', 'success');
                await loadRiddcoin(true); mountApp();
              },
            }, 'Sell back \u00b7 ' + _rcCoin(si.payout));
          })()) : null))))));

  if (tab === 'history') wrap.append(ledgerTable(ledger.filter(r => r.user_id === state.profile.id), false, true));
  if (tab === 'ledger' && isAdmin) wrap.append(ledgerTable(ledger, true));

  // ── BALANCES (admin) ──
  if (tab === 'balances' && isAdmin) {
    // EVERY active app account shows here (per Isaac) — zero-balance users
    // included, so the roster doubles as a "who hasn't earned yet" check.
    const byUser = {};
    Object.keys(names).forEach(uid => { byUser[uid] = 0; });
    ledger.forEach(r => { byUser[r.user_id] = (byUser[r.user_id] || 0) + (Number(r.delta) || 0); });
    const rows = Object.entries(byUser).sort((x, y) => (y[1] - x[1])
      || String(names[x[0]] || '').localeCompare(String(names[y[0]] || '')));
    wrap.append(el('div', { class: 'card overflow-hidden' },
      el('table', { class: 'w-full text-xs' },
        el('thead', {}, el('tr', { class: 'text-left text-[9px] uppercase tracking-widest text-muted-' },
          el('th', { class: 'px-3 py-2' }, '#'), el('th', { class: 'px-3 py-2' }, 'User'),
          el('th', { class: 'px-3 py-2 text-right' }, 'Balance'))),
        el('tbody', {},
          rows.length === 0 ? el('tr', {}, el('td', { colspan: '3', class: 'px-3 py-6 text-center text-muted-' }, 'Nobody holds RIDDCOIN yet — grant some under ⚙️ Manage.')) : null,
          ...rows.map(([uid, bal], i) => el('tr', {
            class: 'border-t border- cursor-pointer hover:brightness-95 transition',
            title: 'Click for ' + (names[uid] || 'this user') + '\u2019s full RIDDCOIN history',
            onclick: () => openRcUserHistory(uid),
          },
            el('td', { class: 'px-3 py-2 tabular-nums text-muted-' }, '#' + (i + 1)),
            el('td', { class: 'px-3 py-2 font-semibold' }, names[uid] || uid),
            el('td', { class: 'px-3 py-2 text-right tabular-nums font-black', style: { color: bal >= 0 ? '#DF643A' : '#B91C1C' } }, _rcCoin(bal))))))));
  }

  // ── MANAGE (admin): grant/deduct + catalog ──
  if (tab === 'manage' && isAdmin) {
    // Grant / deduct
    const userSel = el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] flex-1 min-w-0', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } },
      el('option', { value: '' }, 'Pick a user…'),
      ...Object.entries(names).sort((a, b) => String(a[1]).localeCompare(String(b[1])))
        .map(([id, nm]) => el('option', { value: id }, nm)));
    const amtIn = el('input', { type: 'number', min: '1', step: '1', placeholder: 'Amount', class: 'rounded-lg border px-2.5 py-1 text-[11px] tabular-nums', style: { width: '110px', borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } });
    const whyIn = el('input', { type: 'text', placeholder: 'Reason (required — lands in the ledger)', class: 'rounded-lg border px-2.5 py-1 text-[11px] flex-1 min-w-0', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } });
    const doGrant = async (sign) => {
      const uid = userSel.value, amt = Math.abs(Number(amtIn.value) || 0), why = whyIn.value.trim();
      if (!uid) return toast('Pick a user', 'warn');
      if (!amt) return toast('Enter an amount', 'warn');
      if (!why) return toast('A reason is required — it goes in the history log', 'warn');
      const { error } = await supabase.rpc('riddcoin_grant', { p_user: uid, p_amount: sign * amt, p_reason: why });
      if (error) return toast('Failed: ' + error.message, 'error');
      toast((sign > 0 ? 'Granted ' : 'Deducted ') + _rcCoin(amt) + (sign > 0 ? ' to ' : ' from ') + (names[uid] || 'user'), 'success');
      amtIn.value = ''; whyIn.value = '';
      await loadRiddcoin(true); mountApp();
    };
    wrap.append(el('div', { class: 'card p-4' },
      el('h3', { class: 'text-sm font-bold mb-2' }, '🪙 Grant / deduct RIDDCOIN'),
      el('div', { class: 'flex items-center gap-2 flex-wrap' },
        userSel, amtIn, whyIn,
        el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => doGrant(1) }, '+ Add'),
        el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold cursor-pointer border', style: { borderColor: '#DC2626', color: '#DC2626' }, onclick: () => doGrant(-1) }, '− Deduct'))));

    // Catalog manager
    const saveItem = async (payload) => {
      const { error } = await supabase.rpc('riddcoin_save_item', payload);
      if (error) return toast('Save failed: ' + error.message, 'error');
      toast(payload.p_delete ? 'Prize removed' : 'Prize saved', 'success');
      await loadRiddcoin(true); mountApp();
    };
    const itemRow = (i) => {
      const meta = i ? _rcMeta(i) : { text: '', photos: [] };
      const nameIn = el('input', { type: 'text', value: i ? i.name : '', placeholder: 'Item name…', class: 'rounded border px-2.5 py-1 text-[11px] flex-1 min-w-0', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } });
      const costIn = el('input', { type: 'number', min: '1', value: i ? String(i.cost) : '', placeholder: 'Cost', class: 'rounded border px-2.5 py-1 text-[11px] tabular-nums', style: { width: '84px', borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } });
      const stockIn = el('input', { type: 'number', min: '0', value: (i && i.stock != null) ? String(i.stock) : '', placeholder: '∞', title: 'Stock — blank = unlimited', class: 'rounded border px-2.5 py-1 text-[11px] tabular-nums', style: { width: '64px', borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } });
      const descIn = el('input', { type: 'text', value: meta.text, placeholder: 'Description shown on the product page…', class: 'rounded border px-2.5 py-1 text-[11px] w-full', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' } });
      const activeIn = el('input', { type: 'checkbox', checked: i ? !!i.active : true, title: 'Visible in the store' });
      const doSave = (photos, del) => {
        const nm = nameIn.value.trim(); const cost = Number(costIn.value) || 0;
        if (!del && (!nm || cost <= 0)) return toast('Name + a positive cost required', 'warn');
        saveItem({
          p_id: i ? i.id : null, p_name: del ? i.name : nm, p_cost: del ? i.cost : cost,
          p_stock: del ? i.stock : (stockIn.value === '' ? null : Math.max(0, Number(stockIn.value) || 0)),
          p_active: del ? i.active : !!activeIn.checked,
          p_description: JSON.stringify({ text: del ? meta.text : descIn.value.trim(), photos: photos || meta.photos }),
          p_delete: !!del,
        });
      };
      // Photo manager — Shopify vibe: multiple images per item; first photo
      // is the store-card cover. Uploads land in the public riddcoin bucket
      // (run riddcoin_storage.sql once) and save immediately.
      const photoIn = el('input', { type: 'file', accept: 'image/*', multiple: 'multiple', style: { display: 'none' } });
      photoIn.addEventListener('change', async () => {
        const files = [...(photoIn.files || [])];
        photoIn.value = '';
        if (!files.length) return;
        toast('Uploading ' + files.length + ' photo' + (files.length === 1 ? '' : 's') + '…', 'info');
        const urls = await _rcUploadPhotos(files);
        if (urls.length) doSave([...meta.photos, ...urls], false);
      });
      const photoStrip = !i ? null : el('div', { class: 'flex items-center gap-1.5 flex-wrap w-full pb-1' },
        ...meta.photos.map((u, j) => el('div', { class: 'relative', style: { position: 'relative' } },
          el('img', { src: u, alt: '', title: j === 0 ? 'Cover photo' : '', style: { width: '44px', height: '44px', objectFit: 'cover', borderRadius: '0', border: j === 0 ? '2px solid var(--accent)' : '2px solid var(--border-2)' } }),
          el('button', {
            class: 'cursor-pointer', title: 'Remove this photo',
            style: { position: 'absolute', top: '-6px', right: '-6px', width: '16px', height: '16px', lineHeight: '14px', fontSize: '10px', borderRadius: '50%', background: '#DC2626', color: '#fff', border: 'none', padding: '0' },
            onclick: () => doSave(meta.photos.filter((_, k) => k !== j), false),
          }, '✕'))),
        el('button', {
          class: 'px-2.5 py-1 rounded text-[11px] font-semibold cursor-pointer border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' },
          title: 'Add photos — the first one is the store-card cover',
          onclick: () => photoIn.click(),
        }, '📷 Add photos'), photoIn);
      return el('div', { class: 'py-2 flex flex-col gap-1.5', style: { borderBottom: '1px solid var(--border)' } },
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          nameIn, costIn, stockIn,
          el('label', { class: 'text-[10px] text-muted- flex items-center gap-1' }, activeIn, 'live'),
          el('button', {
            class: 'px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: () => doSave(null, false),
          }, i ? 'Save' : '+ Add'),
          i ? el('button', {
            class: 'px-2.5 py-1 rounded text-[11px] cursor-pointer', style: { color: '#DC2626' }, title: 'Remove this item',
            onclick: () => { if (confirm('Remove "' + i.name + '" from the store?')) doSave(null, true); },
          }, '✕') : null),
        descIn,
        photoStrip);
    };
    // ── 🎰 SPIN BUILDER — icybox-style chance purchases. A spin is a
    // catalog item whose description carries the prize pool + odds +
    // rarity; riddcoin_spin() (riddcoin_spins.sql) rolls it server-side.
    wrap.append((() => {
      const d = state._rcSpinDraft || (state._rcSpinDraft = { id: null, name: '', cost: '', stock: '', pool: [] });
      const spins = items.filter(_rcSpinCfg);
      const loadDraft = (it) => {
        const cfg = it ? _rcSpinCfg(it) : null;
        state._rcSpinDraft = it
          ? { id: it.id, name: it.name, cost: String(it.cost), stock: it.stock != null ? String(it.stock) : '', pool: (cfg.pool || []).map(p2 => ({ name: p2.name || '', odds: Number(p2.odds) || 0, rarity: p2.rarity || 'bronze', value: Number(p2.value) || 0 })) }
          : { id: null, name: '', cost: '', stock: '', pool: [] };
        mountApp();
      };
      const totalOdds = d.pool.reduce((a2, p2) => a2 + (Number(p2.odds) || 0), 0);
      const inp = (val, ph, w, onin) => el('input', {
        type: 'text', value: val, placeholder: ph,
        class: 'rounded border px-2.5 py-1 text-[11px]' + (w ? '' : ' flex-1 min-w-0'),
        style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', ...(w ? { width: w } : {}) },
        oninput: onin,
      });
      const card = el('div', { class: 'card p-4' },
        el('div', { class: 'flex items-center justify-between gap-2 flex-wrap mb-1' },
          el('h3', { class: 'text-sm font-bold' }, '🎰 Spin builder'),
          spins.length ? el('select', {
            class: 'rounded border px-2.5 py-1 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' },
            onchange: (e) => loadDraft(items.find(it => it.id === e.target.value) || null),
          },
            el('option', { value: '' }, d.id ? 'New spin…' : 'Edit existing…'),
            ...spins.map(it => { const o = el('option', { value: it.id }, it.name); if (it.id === d.id) o.selected = true; return o; })) : null),
        el('div', { class: 'text-[10px] text-muted- mb-2' },
          'Reps pay the cost for ONE roll across this pool — the prize is decided server-side by the odds, then revealed with the Mystery Box carousel. Odds should sum to 100. Value \u00a4 enables sell-back: winners can trade the prize back for 90% of its value and keep spinning (run riddcoin_sellback.sql once).'),
        el('div', { class: 'flex items-center gap-2 flex-wrap mb-2' },
          inp(d.name, 'Spin name (e.g. Gold Spin)…', null, (e) => { d.name = e.target.value; }),
          inp(String(d.cost || ''), 'Cost', '84px', (e) => { d.cost = e.target.value; }),
          inp(String(d.stock || ''), '∞ stock', '70px', (e) => { d.stock = e.target.value; })),
        ...d.pool.map((p2, idx) => el('div', { class: 'flex items-center gap-2 py-1.5 flex-wrap', style: { borderBottom: '1px solid var(--border)' } },
          inp(p2.name, 'Prize…', null, (e) => { p2.name = e.target.value; }),
          inp(String(p2.odds || ''), '%', '58px', (e) => { p2.odds = Number(e.target.value) || 0; }),
          inp(String(p2.value || ''), 'Value \u00a4', '76px', (e) => { p2.value = Number(e.target.value) || 0; }),
          (() => {
            const sel = el('select', {
              class: 'rounded border px-1.5 py-1 text-xs font-bold',
              style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: (typeof MB_RARITIES !== 'undefined' && MB_RARITIES[p2.rarity]) ? MB_RARITIES[p2.rarity].color : 'var(--text)' },
              onchange: (e) => { p2.rarity = e.target.value; mountApp(); },
            }, ...Object.entries(typeof MB_RARITIES !== 'undefined' ? MB_RARITIES : { bronze: { label: 'Bronze' } }).map(([k2, m2]) => {
              const o = el('option', { value: k2 }, m2.label || k2); if (k2 === (p2.rarity || 'bronze')) o.selected = true; return o;
            }));
            return sel;
          })(),
          el('button', { class: 'text-xs cursor-pointer', style: { color: '#DC2626' }, title: 'Remove prize', onclick: () => { d.pool.splice(idx, 1); mountApp(); } }, '✕'))),
        el('div', { class: 'flex items-center justify-between gap-2 mt-2 flex-wrap' },
          el('button', {
            class: 'px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer border', style: { borderColor: 'var(--border-2)', color: 'var(--text)' },
            onclick: () => { d.pool.push({ name: '', odds: 0, rarity: 'bronze', value: 0 }); mountApp(); },
          }, '+ Add prize'),
          el('div', { class: 'text-[11px] font-bold tabular-nums', style: { color: totalOdds === 100 ? '#DF643A' : '#A9441F' } },
            'Total ' + totalOdds + '%' + (totalOdds === 100 ? ' ✓' : ' — should be 100')),
          el('button', {
            class: 'px-2.5 py-1 rounded text-[11px] font-bold cursor-pointer', style: { background: 'var(--accent)', color: 'var(--accent-text)' },
            onclick: async () => {
              const nm = String(d.name || '').trim();
              const cost = Math.round(Number(d.cost) || 0);
              const pool = d.pool.map(p2 => ({ name: String(p2.name || '').trim(), odds: Number(p2.odds) || 0, rarity: p2.rarity || 'bronze', value: Number(p2.value) || 0 })).filter(p2 => p2.name && p2.odds > 0);
              if (!nm || cost <= 0) return toast('Spin name + a positive cost required', 'warn');
              if (!pool.length) return toast('Add at least one prize with odds', 'warn');
              const { error } = await supabase.rpc('riddcoin_save_item', {
                p_id: d.id, p_name: nm, p_cost: cost,
                p_stock: d.stock === '' ? null : Math.max(0, Number(d.stock) || 0),
                p_active: true, p_description: JSON.stringify({ spin: true, pool }), p_delete: false,
              });
              if (error) return toast('Save failed: ' + error.message, 'error');
              toast('🎰 Spin saved — live in the store', 'success');
              state._rcSpinDraft = null;
              await loadRiddcoin(true); mountApp();
            },
          }, d.id ? 'Save spin' : '+ Create spin')));
      return card;
    })());
    wrap.append(el('div', { class: 'card p-4' },
      el('h3', { class: 'text-sm font-bold mb-1' }, '🛍️ Store catalog'),
      el('div', { class: 'text-[10px] text-muted- mb-2' }, 'Name · cost in RIDDCOIN · stock (blank = unlimited) · live toggle · description · photos (first = card cover; reps click into a full product page). Redeems decrement stock automatically.'),
      ...items.map(itemRow),
      itemRow(null)));
  }

  return wrap;
}

function viewTraining() {
  // Reps see the tab (so they know it's coming) but the modules are still
  // being built out for them — placeholder until the content is rep-ready.
  if (!isAdminRole(state.profile && state.profile?.role)) {
    return el('div', { class: 'card p-12 text-center flex flex-col items-center gap-3 max-w-2xl mx-auto' },
      el('div', { class: 'text-5xl' }, '🚧'),
      el('div', { class: 'text-xl font-bold' }, 'Under Construction'),
      el('div', { class: 'text-sm text-muted-' }, 'Training content is on the way — check back soon.'));
  }
  const wrap = el('div', { class: 'flex flex-col gap-4 max-w-5xl mx-auto' });
  const mod = (state._trainingOpen != null) ? TRAINING_MODULES[state._trainingOpen] : null;

  // ── Native PDF viewer (e.g. the sales manual) ──
  if (mod && mod.pdf) {
    wrap.append(
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
        el('button', { class: 'text-xs font-semibold', style: { color: 'var(--accent)' },
          onclick: () => { state._trainingOpen = null; mountApp(); } }, '← All training'),
        el('div', { class: 'text-sm font-bold' }, mod.title),
        el('a', { href: _trainingImg(mod.pdf), target: '_blank', rel: 'noopener',
          class: 'text-xs font-semibold', style: { color: 'var(--accent)' } }, 'Open / download ↗'),
      ),
      el('div', { class: 'card overflow-hidden', style: { height: 'calc(100vh - 200px)', minHeight: '480px' } },
        el('iframe', { src: _trainingImg(mod.pdf) + '#view=FitH', title: mod.title,
          style: { width: '100%', height: '100%', border: '0', display: 'block' } }),
      ),
    );
    return wrap;
  }

  // ── Native screen viewer for a ported module ──
  if (mod && Array.isArray(mod.screens) && mod.screens.length) {
    const i = Math.max(0, Math.min(state._trainingScreen || 0, mod.screens.length - 1));
    const scr = mod.screens[i];
    wrap.append(
      el('div', { class: 'flex items-center justify-between gap-3 flex-wrap' },
        el('button', { class: 'text-xs font-semibold', style: { color: 'var(--accent)' },
          onclick: () => { state._trainingOpen = null; state._trainingScreen = 0; mountApp(); } }, '← All training'),
        el('div', { class: 'text-sm font-bold' }, mod.title),
        el('div', { class: 'text-xs text-muted-' }, (i + 1) + ' / ' + mod.screens.length),
      ),
      el('div', { class: 'card overflow-hidden flex justify-center', style: { background: '#0b0b0b' } },
        el('img', { src: _trainingImg(scr.image), alt: scr.label || mod.title,
          style: { maxWidth: '100%', height: 'auto', display: 'block' } }),
      ),
      mod.screens.length > 1 ? el('div', { class: 'flex items-center justify-between gap-2 flex-wrap' },
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' },
          onclick: () => { state._trainingScreen = Math.max(0, i - 1); mountApp(); } }, '← Prev'),
        el('div', { class: 'flex gap-1 flex-wrap justify-center' },
          ...mod.screens.map((s, j) => el('button', {
            class: 'text-[11px] px-2.5 py-1 rounded font-semibold',
            style: { background: j === i ? 'var(--accent)' : 'var(--card-2)', color: j === i ? 'var(--accent-text)' : 'var(--text)' },
            onclick: () => { state._trainingScreen = j; mountApp(); },
          }, s.label || ('Screen ' + (j + 1)))),
        ),
        el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' },
          onclick: () => { state._trainingScreen = Math.min(mod.screens.length - 1, i + 1); mountApp(); } }, 'Next →'),
      ) : null,
    );
    return wrap;
  }

  // ── Module grid ──
  wrap.append(
    el('div', {},
      el('h1', { class: 'text-lg font-bold' }, '🎓 Training'),
      el('div', { class: 'text-xs text-muted- mt-0.5' }, 'In-app training modules.'),
    ),
  );
  wrap.append(el('div', { class: 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' },
    ...TRAINING_MODULES.map((m, idx) => {
      const ported = m.pdf || (Array.isArray(m.screens) && m.screens.length);
      const inner = [
        el('div', { class: 'flex items-center justify-between gap-2' },
          el('div', { class: 'text-base font-bold' }, m.title),
          el('span', { class: 'text-xs font-semibold', style: { color: 'var(--accent)' } }, ported ? 'Open' : 'Open ↗'),
        ),
        m.description && el('div', { class: 'text-sm text-muted-' }, m.description),
        !ported && el('div', { class: 'text-[10px] uppercase tracking-widest font-bold', style: { color: 'var(--text-subtle)' } }, 'Not ported yet'),
      ];
      return ported
        ? el('button', { class: 'card p-4 flex flex-col gap-2 text-left transition hover:brightness-95 cursor-pointer',
            onclick: () => { state._trainingOpen = idx; state._trainingScreen = 0; mountApp(); } }, ...inner)
        : el('a', { href: TRAINING_TILED_BASE + m.tiled, target: '_blank', rel: 'noopener',
            class: 'card p-4 flex flex-col gap-2 transition hover:brightness-95 cursor-pointer',
            style: { color: 'inherit', textDecoration: 'none' } }, ...inner);
    }),
  ));
  return wrap;
}

