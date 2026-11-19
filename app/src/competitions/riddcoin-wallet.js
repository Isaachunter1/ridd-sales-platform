// ┌─ competitions/riddcoin-wallet.js ────────────────────────────────────────
// │ RIDDCOIN, the simple version (per Isaac, Nov 16 2026): a Wallet tab under
// │ Sales where a rep sees their balance and history, and a RIDDCOIN page under
// │ Settings where an admin adds or subtracts coins for any user, with a reason,
// │ and opens each user's history (every add, every subtraction, what it was for).
// │ Rides on the existing ledger (riddcoin_ledger, append-only) and the
// │ riddcoin_grant RPC from competitions/riddcoin.js — nothing new in the database.
// └────────────────────────────────────────────────────────────────────────
function _rcEnsureLoaded(viewKey) {
  if (!state._rcLoading && (!state._rcLoadedAt || Date.now() - state._rcLoadedAt > 60000)) {
    loadRiddcoin().then((fetched) => { if (fetched && (viewKey === 'admin' ? state.view === 'admin' && state.adminSection === 'riddcoin' : state.view === viewKey)) mountApp(); });
  }
}
function _rcSetupCard() {
  if (!(state._rcErr && /riddcoin|relation|does not exist|schema cache/i.test(state._rcErr))) return null;
  return el('div', { class: 'card p-6 text-center' },
    el('h3', { class: 'text-base font-bold mb-1' }, 'RIDDCOIN is not set up yet'),
    el('p', { class: 'text-xs text-muted-' }, 'Run db/migrations/20260730_riddcoin.sql in the Supabase SQL Editor once, then reload.'),
    el('p', { class: 'text-[10px] text-muted- mt-2' }, state._rcErr));
}
const _rcModal = (node, maxWidth) => {
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const card = el('div', { class: 'card p-5 w-full', style: { maxWidth: maxWidth || '640px' } });
  overlay.append(card);
  node(card, close);
  document.body.append(overlay);
  return close;
};
// One ledger table, newest first. `showWho` adds the granted-by column (admin).
function _rcHistoryTable(rows, showWho) {
  const names = state._rcNames || {};
  return el('table', { class: 'w-full text-xs' },
    el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { color: 'var(--text-muted)' } }, el('tr', {},
      el('th', { class: 'py-1.5 pr-2 text-left' }, 'When'), el('th', { class: 'py-1.5 pr-2 text-right' }, 'Amount'), el('th', { class: 'py-1.5 pr-2 text-left' }, 'Incentive / reason'), showWho ? el('th', { class: 'py-1.5 text-left' }, 'By') : null)),
    el('tbody', {},
      rows.length === 0 ? el('tr', {}, el('td', { class: 'py-6 text-center text-muted-', colspan: showWho ? 4 : 3 }, 'No RIDDCOIN activity yet.')) : null,
      ...rows.map(r => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'py-1.5 pr-2 whitespace-nowrap text-muted- tabular-nums' }, _rcWhen(r.created_at)),
        el('td', { class: 'py-1.5 pr-2 text-right tabular-nums font-black whitespace-nowrap', style: { color: r.delta > 0 ? '#DF643A' : '#B91C1C' } }, (r.delta > 0 ? '+' : '') + _rcCoin(r.delta)),
        el('td', { class: 'py-1.5 pr-2' }, r.reason || '—'),
        showWho ? el('td', { class: 'py-1.5 text-muted- whitespace-nowrap' }, names[r.created_by] || '—') : null))));
}

// ── Sales › Wallet (every rep) ─────────────────────────────────────────────
function viewWallet() {
  _rcEnsureLoaded('wallet');
  const me = state.profile || {};
  const rows = (state._rcLedger || []).filter(r => r.user_id === me.id);
  const bal = rows.reduce((a, r) => a + (Number(r.delta) || 0), 0);
  const earned = rows.filter(r => r.delta > 0).reduce((a, r) => a + Number(r.delta), 0);
  const spent = rows.filter(r => r.delta < 0).reduce((a, r) => a + Number(r.delta), 0);
  const setup = _rcSetupCard();
  return el('div', { class: 'flex flex-col gap-4 w-full fade-in' },
    el('div', { class: 'card p-5 flex items-center justify-between gap-4 flex-wrap', style: { background: 'var(--text)', color: 'var(--bg)' } },
      el('div', {},
        el('div', { class: 'text-[9px] font-black', style: { letterSpacing: '.25em', opacity: '.85' } }, 'RIDDCOIN'),
        el('div', { class: 'font-display text-3xl leading-none' }, 'WALLET'),
        el('div', { class: 'text-xs mt-1', style: { opacity: '.7' } }, 'Earned through incentives and competitions · ' + (earned ? _rcCoin(earned) + ' earned' : 'nothing earned yet') + (spent ? ' · ' + _rcCoin(Math.abs(spent)) + ' used' : ''))),
      el('div', { class: 'text-right' },
        el('div', { class: 'text-[9px] font-black uppercase', style: { letterSpacing: '.18em', opacity: '.6' } }, 'Your balance'),
        el('div', { class: 'font-display text-4xl leading-none tabular-nums', style: { color: '#DF643A' } }, _rcCoin(bal)))),
    setup || el('div', { class: 'card p-4' },
      el('h3', { class: 'text-base font-bold mb-2' }, 'History'),
      el('div', { style: { maxHeight: '60vh', overflowY: 'auto' } }, _rcHistoryTable(rows, false))));
}

// ── Settings › RIDDCOIN (admins) ───────────────────────────────────────────
function adminRiddcoin() {
  _rcEnsureLoaded('admin');
  const names = state._rcNames || {};
  const profiles = (state.allProfiles || []).filter(p => p && p.id && p.role !== 'developer');
  const ledger = state._rcLedger || [];
  const balOf = (id) => ledger.filter(r => r.user_id === id).reduce((a, r) => a + (Number(r.delta) || 0), 0);
  const lastOf = (id) => ledger.find(r => r.user_id === id);
  const showInactive = !!state._rcAdminInactive;
  const total = profiles.reduce((a, p) => a + balOf(p.id), 0);
  const roleLbl = (r) => (typeof roleLabel === 'function' ? roleLabel(r) : r) || '';
  const inSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' };

  // Add / subtract for one user — amount + what the incentive was for. The reason is required: it is the history.
  const openAdjust = (p, sign) => _rcModal((card, close) => {
    const amtIn = el('input', { type: 'number', min: '1', step: '1', placeholder: 'Amount', class: 'rounded-lg border px-2.5 py-1.5 text-sm tabular-nums w-full', style: inSt });
    const whyIn = el('input', { type: 'text', placeholder: sign > 0 ? 'What was the incentive? (e.g. Top closer · week of Nov 9)' : 'Why? (e.g. Prize pickup · YETI cooler)', class: 'rounded-lg border px-2.5 py-1.5 text-sm w-full', style: inSt });
    const go = async () => {
      const amt = Math.abs(Math.round(Number(amtIn.value) || 0)), why = whyIn.value.trim();
      if (!amt) return toast('Enter an amount', 'warn');
      if (!why) return toast('Say what it was for — it goes in the history', 'warn');
      const { error } = await supabase.rpc('riddcoin_grant', { p_user: p.id, p_amount: sign * amt, p_reason: why });
      if (error) return toast('Failed: ' + error.message, 'error');
      toast((sign > 0 ? 'Added ' : 'Subtracted ') + _rcCoin(amt) + (sign > 0 ? ' to ' : ' from ') + (p.full_name || 'user'), 'success');
      close(); await loadRiddcoin(true); mountApp();
    };
    whyIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    card.classList.add('flex', 'flex-col', 'gap-3'); card.style.maxWidth = '420px';
    card.append(
      el('div', { class: 'flex items-start justify-between gap-3' },
        el('div', {}, el('h3', { class: 'text-base font-bold' }, (sign > 0 ? 'Add RIDDCOIN · ' : 'Subtract RIDDCOIN · ') + (p.full_name || '—')),
          el('div', { class: 'text-xs text-muted-' }, 'Balance now ', el('span', { class: 'font-black tabular-nums', style: { color: '#DF643A' } }, _rcCoin(balOf(p.id))))),
        el('button', { class: 'text-2xl leading-none text-muted- px-1', 'aria-label': 'Close', onclick: close }, '×')),
      el('label', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-subtle)' } }, 'Amount'), amtIn,
      el('label', { class: 'text-[10px] uppercase tracking-wider font-semibold', style: { color: 'var(--text-subtle)' } }, sign > 0 ? 'Incentive' : 'Reason'), whyIn,
      el('div', { class: 'flex justify-end gap-2 mt-1' },
        el('button', { class: 'px-3 py-1.5 rounded-lg text-xs font-semibold border', style: { borderColor: 'var(--border-2)' }, onclick: close }, 'Cancel'),
        el('button', { class: 'px-3 py-1.5 rounded-lg text-xs font-bold', style: sign > 0 ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { background: '#DC2626', color: '#fff' }, onclick: go }, sign > 0 ? '+ Add' : '− Subtract')));
    setTimeout(() => amtIn.focus(), 30);
  });

  const openHistory = (p) => _rcModal((card, close) => {
    const rows = ledger.filter(r => r.user_id === p.id);
    card.style.maxWidth = '680px';
    card.append(
      el('div', { class: 'flex items-center justify-between gap-3 mb-3' },
        el('div', {}, el('h3', { class: 'text-base font-bold' }, p.full_name || '—'),
          el('div', { class: 'text-xs text-muted-' }, rows.length + ' entr' + (rows.length === 1 ? 'y' : 'ies') + ' · balance ', el('span', { class: 'font-black tabular-nums', style: { color: '#DF643A' } }, _rcCoin(balOf(p.id))))),
        el('div', { class: 'flex items-center gap-2' },
          el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => { close(); openAdjust(p, 1); } }, '+ Add'),
          el('button', { class: 'px-2.5 py-1 rounded-lg text-[11px] font-bold border', style: { borderColor: '#DC2626', color: '#DC2626' }, onclick: () => { close(); openAdjust(p, -1); } }, '− Subtract'),
          el('button', { class: 'text-2xl leading-none text-muted- px-1', 'aria-label': 'Close', onclick: close }, '×'))),
      el('div', { style: { maxHeight: '62vh', overflowY: 'auto' } }, _rcHistoryTable(rows, true)));
  });

  const row = (p) => {
    const last = lastOf(p.id), bal = balOf(p.id);
    return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
      el('td', { class: 'px-3 py-1.5 font-semibold whitespace-nowrap cursor-pointer hover:underline', onclick: () => openHistory(p) }, p.full_name || names[p.id] || '—',
        p.is_active === false ? el('span', { class: 'ml-1.5 text-[9px] uppercase tracking-wider', style: { color: 'var(--text-subtle)' } }, 'inactive') : null),
      el('td', { class: 'px-3 py-1.5 text-muted- whitespace-nowrap hidden sm:table-cell' }, roleLbl(p.role)),
      el('td', { class: 'px-3 py-1.5 text-right tabular-nums font-black whitespace-nowrap', style: { color: bal > 0 ? '#DF643A' : bal < 0 ? '#B91C1C' : 'var(--text-subtle)' } }, _rcCoin(bal)),
      el('td', { class: 'px-3 py-1.5 text-muted- hidden sm:table-cell', style: { maxWidth: '320px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }, title: last ? (last.reason || '') : '' }, last ? ((last.delta > 0 ? '+' : '') + _rcCoin(last.delta) + ' · ' + (last.reason || '—') + ' · ' + _rcWhen(last.created_at)) : '—'),
      el('td', { class: 'px-3 py-1.5 text-right whitespace-nowrap' },
        el('button', { class: 'px-2 py-0.5 rounded-lg text-[11px] font-bold mr-1', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, title: 'Add RIDDCOIN', onclick: () => openAdjust(p, 1) }, '+'),
        el('button', { class: 'px-2 py-0.5 rounded-lg text-[11px] font-bold border mr-1', style: { borderColor: '#DC2626', color: '#DC2626' }, title: 'Subtract RIDDCOIN', onclick: () => openAdjust(p, -1) }, '−'),
        el('button', { class: 'px-2 py-0.5 rounded-lg text-[11px] font-semibold border', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, onclick: () => openHistory(p) }, 'History')));
  };
  // Role filter (per Isaac, Nov 18): everyone can hold RIDDCOIN, so the list is all users; this narrows it by rep type.
  const kindOf = (p) => { const g = typeof repTypeGroup === 'function' ? repTypeGroup(p) : ''; if (g === 'office') return ((p.rep_type || '') === 'loyalty_rep' || /loyalty/.test(String(p.role || ''))) ? 'loyalty' : 'inside'; return g || 'other'; };
  const KINDS = [['all', 'All roles'], ['inside', 'Inside Sales'], ['loyalty', 'Loyalty'], ['d2d', 'Sales Reps'], ['tech', 'Technicians'], ['admin', 'Admins'], ['other', 'Other']];
  const kind = state._rcAdminKind || 'all';
  const tableBody = () => {
    const qq = String(state._rcAdminQ || '').toLowerCase();
    const kind = state._rcAdminKind || 'all';   // read live — the role picker swaps the body in place, so a value captured at render went stale (per Isaac, Nov 19: 'nothing updates')
    const rows = profiles.filter(p => showInactive || p.is_active !== false).filter(p => kind === 'all' || kindOf(p) === kind).filter(p => !qq || String(p.full_name || '').toLowerCase().includes(qq)).sort((a, b) => String(a.full_name || '').localeCompare(String(b.full_name || '')));
    return el('tbody', { id: 'rc-admin-body' }, rows.length ? rows.map(row) : [el('tr', {}, el('td', { class: 'py-6 text-center text-muted-', colspan: 5 }, 'No users match.'))]);
  };
  const search = el('input', { type: 'search', placeholder: 'Find a user…', value: state._rcAdminQ || '', class: 'rounded-lg border px-2.5 py-1 text-[11px]', style: Object.assign({ width: '180px' }, inSt),
    oninput: (e) => { state._rcAdminQ = e.target.value; const body = document.getElementById('rc-admin-body'); if (body) body.replaceWith(tableBody()); } });
  const setup = _rcSetupCard();
  return el('div', { class: 'flex flex-col gap-4' },
    el('div', { class: 'card p-4 flex items-center gap-4 flex-wrap' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'RIDDCOIN Wallet'),
        el('div', { class: 'text-[11px] text-muted-' }, 'Add or subtract coins for any user; every change needs a reason and lands in that user’s history. Reps see their balance on Sales › Wallet.')),
      el('div', { class: 'ml-auto text-right' },
        el('div', { class: 'text-[9px] uppercase tracking-widest', style: { color: 'var(--text-subtle)' } }, 'In circulation'),
        el('div', { class: 'text-xl font-black tabular-nums', style: { color: '#DF643A' } }, _rcCoin(total)))),
    setup || el('div', { class: 'card overflow-hidden' },
      el('div', { class: 'px-4 py-2.5 flex items-center gap-2 flex-wrap', style: { borderBottom: '1px solid var(--border)' } },
        search,
        el('select', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: inSt, onchange: (e) => { state._rcAdminKind = e.target.value; const body = document.getElementById('rc-admin-body'); if (body) body.replaceWith(tableBody()); } },
          ...KINDS.map(([v, l]) => el('option', { value: v, selected: v === kind }, l + (v === 'all' ? '' : ' (' + profiles.filter(p => (showInactive || p.is_active !== false) && kindOf(p) === v).length + ')')))),
        el('label', { class: 'text-[11px] flex items-center gap-1.5 cursor-pointer', style: { color: 'var(--text-muted)' } },
          el('input', { type: 'checkbox', checked: showInactive, onchange: (e) => { state._rcAdminInactive = e.target.checked; mountApp(); } }), 'Show inactive'),
        el('span', { class: 'ml-auto text-[11px]', style: { color: 'var(--text-muted)' } }, ledger.length + ' ledger entries')),
      el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-xs' },
        el('thead', { class: 'text-[10px] uppercase tracking-wider', style: { color: 'var(--text-muted)', background: 'var(--card-2)' } }, el('tr', {},
          el('th', { class: 'px-3 py-2 text-left' }, 'User'), el('th', { class: 'px-3 py-2 text-left hidden sm:table-cell' }, 'Role'), el('th', { class: 'px-3 py-2 text-right' }, 'Balance'), el('th', { class: 'px-3 py-2 text-left hidden sm:table-cell' }, 'Last change'), el('th', { class: 'px-3 py-2' }, ''))),
        tableBody()))));
}

// ── RIDDCOIN → Marketing incentives (per Isaac, Nov 18) ────────────────────
// Coins added to an office rep's wallet (Inside Sales / Loyalty) are an incentive cost in the month they were
// added. Only admin adds count (positive, not a store sell-back, which carries ref_id); spends and subtractions
// never reduce it — the money was already given. Spend tab → Incentives reads this and CAC follows.
// Denomination (per Isaac, Nov 19): RIDDCOIN is gamified — 100,000 ¤ = $100, so 1 ¤ = $0.001 (three decimals).
// Start (per Isaac, Nov 19): the Nov 18 "DashP Transfer" adds (2,746,000 ¤ moved over from the old platform, 17:22–17:27
// UTC) are balances carried over, not new incentives — counting starts after the transition. Anything dated before
// RC_INCENTIVE_FROM, or any add whose reason names the DashP transfer, is left out.
const RC_USD_PER_COIN = 0.001;
const RC_INCENTIVE_FROM = '2026-11-18T17:30:00Z';
const _rcIsTransfer = (r) => /dash\s*p\b.*transfer|transfer.*dash\s*p\b/i.test(String(r.reason || ''));
function rcCoinsToUsd(c) { return (Number(c) || 0) * RC_USD_PER_COIN; }
// Owner override per ledger add (per Isaac, Nov 19 — "give me the option to zero out amounts that shouldn't count"):
// adminRules.rcIncentiveOverride = { ledgerId: 'out' | 'in' } — 'out' never counts, 'in' counts even if the automatic
// rules (DashP transfer, before the cut-over) would leave it out. Saved company-wide; only the owner can change it.
function _rcOverrides() { const r = typeof _adminRules === 'function' ? _adminRules() : null; return (r && r.rcIncentiveOverride && typeof r.rcIncentiveOverride === 'object') ? r.rcIncentiveOverride : {}; }
function rcSetIncentiveOverride(id, v) {
  if (!(typeof isOwnerUser === 'function' && isOwnerUser())) return;
  const next = Object.assign({}, _rcOverrides()); if (v) next[id] = v; else delete next[id];
  if (typeof _setAdminRule === 'function') _setAdminRule('rcIncentiveOverride', next);
  try { if (typeof saveIndicatorConfigToSupabase === 'function') saveIndicatorConfigToSupabase().catch(() => {}); } catch (e) { /* synced on next save */ }
  state._mklMemo = {}; state._mkpMemo = null;
}
// Why an add does or doesn't count: { counts, why } — the automatic rule, then the owner's override on top.
function rcIncentiveStatus(r) {
  const auto = _rcIsTransfer(r) ? 'Carried over from DashP' : !(Date.parse(r.created_at) >= Date.parse(RC_INCENTIVE_FROM)) ? 'Before the DashP cut-over' : null;
  const o = _rcOverrides()[r.id];
  if (o === 'out') return { counts: false, why: 'Zeroed out by the owner', override: true };
  if (o === 'in') return { counts: true, why: 'Counted by the owner' + (auto ? ' (' + auto.toLowerCase() + ')' : ''), override: true };
  return auto ? { counts: false, why: auto } : { counts: true, why: '' };
}
function rcIncentivesMonth(ym, opts) {
  const led = state._rcLedger || []; if (!led.length) return { total: 0, coins: 0, n: 0, loaded: !!state._rcLoadedAt, rows: [], all: [] };
  const office = new Set((state.allProfiles || []).filter(dashpOfficeIsRep).map(p => p.id));
  let coins = 0, n = 0; const rows = [], all = [];
  for (const r of led) {
    if (!(Number(r.delta) > 0) || r.ref_id || !office.has(r.user_id) || String(r.created_at || '').slice(0, 7) !== ym) continue;
    all.push(r);
    if (!rcIncentiveStatus(r).counts) continue;
    coins += Number(r.delta); n++; rows.push(r);
  }
  return { total: rcCoinsToUsd(coins), coins, n, loaded: true, rows, all };   // total is DOLLARS; all = every add, counted or not
}
// The log behind the Spend tab's RIDDCOIN row (per Isaac, Nov 18): every add that counted for a month (or the
// whole year), who got it, what it was for, who gave it, when — so anything that should not be there is easy to
// spot and reverse in Settings › RIDDCOIN.
function rcOpenIncentiveLog(year, ym) {
  const names = Object.fromEntries((state.allProfiles || []).map(p => [p.id, p.full_name || '—']));
  const months = ym ? [ym] : Array.from({ length: 12 }, (_, i) => year + '-' + String(i + 1).padStart(2, '0'));
  const owner = typeof isOwnerUser === 'function' && isOwnerUser();
  const allRows = months.flatMap(m => rcIncentivesMonth(m).all || []).sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const rows = allRows.filter(r => rcIncentiveStatus(r).counts);
  const total = rows.reduce((a, r) => a + Number(r.delta), 0);   // coins
  const usd = rcCoinsToUsd(total);
  const lbl = ym ? new Date(ym + '-15T00:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) : String(year);
  const overlay = el('div', { class: 'modal-overlay' });
  const close = () => { overlay.remove(); document.removeEventListener('keydown', esc); };
  const esc = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  const th = (t, right) => el('th', { class: 'py-1.5 pr-2 text-[10px] uppercase tracking-wider font-semibold whitespace-nowrap ' + (right ? 'text-right' : 'text-left'), style: { color: 'var(--text-muted)' } }, t);
  overlay.append(el('div', { class: 'card p-5 w-full', style: { maxWidth: '760px' } },
    el('div', { class: 'flex items-center justify-between gap-3 mb-3' },
      el('div', {}, el('h3', { class: 'text-base font-bold' }, 'RIDDCOIN counted as incentives · ' + lbl),
        el('div', { class: 'text-xs text-muted-' }, rows.length + ' add' + (rows.length === 1 ? '' : 's') + ' to office reps · ', el('span', { class: 'font-black tabular-nums', style: { color: '#DF643A' } }, _rcCoin(total)), ' = ' + (usd < 100 ? '$' + usd.toFixed(2) : fmt.usd0(usd)) + ' · subtractions and sell-backs are not in here; fix a wrong add in Settings › RIDDCOIN and it drops out on the next load')),
      el('button', { class: 'text-2xl leading-none text-muted- px-1', 'aria-label': 'Close', onclick: close }, '×')),
    el('div', { style: { maxHeight: '62vh', overflowY: 'auto' } },
      el('table', { class: 'w-full text-xs' },
        el('thead', {}, el('tr', {}, th('When'), th('Rep'), th('Amount', true), th('Incentive'), th('Added by'), th('Counts?'))),
        el('tbody', {},
          allRows.length ? allRows.map(r => { const S = rcIncentiveStatus(r); return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', opacity: S.counts ? '1' : '.5' } },
            el('td', { class: 'py-1.5 pr-2 whitespace-nowrap text-muted- tabular-nums' }, _rcWhen(r.created_at)),
            el('td', { class: 'py-1.5 pr-2 font-semibold whitespace-nowrap' }, names[r.user_id] || '—'),
            el('td', { class: 'py-1.5 pr-2 text-right tabular-nums font-black whitespace-nowrap', style: { color: '#DF643A' }, title: '= $' + rcCoinsToUsd(r.delta).toFixed(2) }, '+' + _rcCoin(r.delta)),
            el('td', { class: 'py-1.5 pr-2' }, r.reason || '—'),
            el('td', { class: 'py-1.5 text-muted- whitespace-nowrap' }, names[r.created_by] || '—'),
            el('td', { class: 'py-1.5 pl-2 whitespace-nowrap' },
              owner ? el('button', { class: 'rounded-md border px-2 py-0.5 text-[10px] font-bold', style: S.counts ? { borderColor: '#16A34A', color: '#16A34A' } : { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, title: (S.why ? S.why + ' · ' : '') + 'Click to ' + (S.counts ? 'zero this out' : 'count it') + ' — saved for everyone',
                  onclick: () => { rcSetIncentiveOverride(r.id, S.counts ? 'out' : 'in'); close(); rcOpenIncentiveLog(year, ym); mountApp(); } }, S.counts ? 'Counts' : 'Zeroed')
                : el('span', { class: 'text-[10px]', style: { color: S.counts ? '#16A34A' : 'var(--text-muted)' }, title: S.why }, S.counts ? 'Counts' : 'Zeroed')),
            ); })
          : [el('tr', {}, el('td', { class: 'py-6 text-center text-muted-', colspan: 6 }, 'No RIDDCOIN added to office reps in ' + lbl + '.'))])))));
  document.body.append(overlay);
}
// Make sure the ledger is in memory wherever incentives are read (Spend tab, Dashboard tiles, P&L).
function rcEnsureLedger() {
  if (!state._rcLoading && (!state._rcLoadedAt || Date.now() - state._rcLoadedAt > 60000) && typeof loadRiddcoin === 'function') {
    loadRiddcoin().then((fetched) => { if (fetched) { state._mkpMemo = null; state._mklMemo = {}; mountApp(); } });
  }
}
