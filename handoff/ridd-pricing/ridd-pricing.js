/*
 * RIDD Pricing — standalone drop-in (built from ridd-sales-platform src/95-pricing.js)
 *
 * Usage (plain JS, no framework, no build step):
 *   <script src="ridd-pricing.js"></script>
 *   RiddPricing.mount(document.getElementById('pricing'));
 *
 * This build is the D2D slick only (display pricing, with the circled M toggle for
 * D2D minimums). Standard / Loyalty are not included.
 *
 * options:
 *   persist         true (default) — remembers the quote in localStorage; false = fresh every mount
 *   headerOffsetPx  number — height of YOUR fixed header, so the quote pins beneath it (default 0)
 *
 * Prices live in PRICING_TIERS below (d2d = display, d2d_min = minimums) — edit there and the
 * slick + quote follow.
 * The order-independence rule (base − add-on constant across Pest/Rodent/TFM/Mole) is what keeps
 * totals identical no matter which plan is sold first; keep it when you change numbers.
 */
(function (global) {
'use strict';

// ── tiny DOM helper (same signature as the app's el()) ──
const el = (tag, attrs = {}, ...children) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(n.style, v);
    else if (k.startsWith('on') && typeof v === 'function') n[k] = v;
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) { if (c == null || c === false) continue; n.append(c instanceof Node ? c : document.createTextNode(String(c))); }
  return n;
};
// ── role helpers (the app's; simplified) ──
const ADMIN_ROLES = ['admin', 'admin_rep'];
const isAdminRole = (r) => ADMIN_ROLES.includes(String(r || ''));
const isOfficeStaffProfile = (p) => ['rep_office', 'rep_office_lead', 'rep_loyalty', 'rep_loyalty_lead'].includes(String((p && p.role) || ''));
// ── RIDD spider mark ──
const RIDD_SPIDER_PATH = 'M87.36 117.39 L87.36 100.86 C87.35 100.74 87.34 100.59 87.34 100.44 L87.34 94.85 C87.34 94.5 87.08 94.21 86.73 94.17 L81.17 94.17 C80.79 94.2 80.51 94.51 80.51 94.91 L80.51 100.55 C80.51 104.86 77 108.36 72.68 108.36 L37.24 108.36 C32.93 108.36 29.42 104.86 29.42 100.55 L29.42 94.91 C29.42 94.51 29.13 94.2 28.74 94.17 L23.16 94.17 C22.84 94.21 22.59 94.51 22.59 94.85 L22.56 117.39 L0.78 117.39 L0.78 86.91 L4.29 86.81 L14.54 86.81 C14.92 86.81 15.22 86.51 15.22 86.13 L15.22 67.03 L0 67.03 L0 45.64 L28.77 45.64 C29.14 45.64 29.45 45.33 29.45 44.96 L29.45 37.81 L19.38 32.52 C16.97 31.25 15.47 28.77 15.47 26.05 L15.44 0 L37.23 0 L37.23 16.09 L46.07 20.86 C49.01 22.45 50.83 25.5 50.83 28.81 L50.83 45.25 C50.83 49.53 47.34 53.02 43.05 53.02 L37.49 53.02 C37.1 53.02 36.79 53.33 36.79 53.72 L36.78 86.07 C36.78 86.48 37.11 86.81 37.52 86.81 L72.41 86.81 C72.82 86.81 73.15 86.48 73.15 86.07 L73.15 60.41 C73.08 59.96 73.07 59.53 73.07 59.28 L73.07 53.7 C73.07 53.32 72.76 53.02 72.39 53.02 L66.8 53.02 C62.52 53.02 59.03 49.53 59.03 45.25 L59.03 28.81 C59.03 25.5 60.85 22.46 63.77 20.87 L73.01 15.88 L73.01 0 L94.8 0 L94.79 25.83 C94.79 28.56 93.29 31.04 90.88 32.31 L80.41 37.81 L80.41 44.96 C80.41 45.33 80.71 45.64 81.09 45.64 L109.16 45.64 L109.16 67.03 L94.7 67.03 L94.7 86.13 C94.7 86.51 95.01 86.81 95.38 86.81 L109.15 86.81 L109.15 117.39 L87.36 117.39 Z';
function riddSpiderMark(px) { const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 109.2 117.4'); s.setAttribute('width', px); s.setAttribute('height', px); s.setAttribute('aria-hidden', 'true'); const p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', RIDD_SPIDER_PATH); p.setAttribute('fill', '#DF643A'); s.append(p); s.style.display = 'block'; return s; }
// ── state (the app keeps this on its global state; here it's module-local + optional localStorage) ──
const STORE_KEY = 'ridd_pricing_quote_v1';
const state = { profile: { role: 'rep_sales' }, modules: {} };
let _persist = true;
function _load() { if (!_persist) return; try { const j = JSON.parse(localStorage.getItem(STORE_KEY) || 'null'); if (j && typeof j === 'object') state.modules.pricing = j; } catch (e) { /* ignore */ } }
function _save() { if (!_persist) return; try { localStorage.setItem(STORE_KEY, JSON.stringify(state.modules.pricing || {})); } catch (e) { /* ignore */ } }

// ┌─ src/95-pricing.js ────────────────────────────────────────────────────────
// │ Pricing tab — the 2026 pricing slicks as a live quote builder.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
// Per Isaac (Sep 17 2026): four tiers (D2D Display · D2D Minimums · Standard ·
// Loyalty), the tier that opens first follows the rep type (D2D sellers →
// D2D Display, office staff → Standard, loyalty reps → Loyalty), and the
// rep builds a quote — pick the base plan + frequency, tick add-ons (and
// one-time services where the tier has them) — with the combined INITIAL and
// MONTHLY totals pinned at the bottom.
//
// Numbers mirror the printed slicks exactly. Edit here and the PDFs together.
const PRICING_TIERS = [
  { id: 'd2d',      label: 'D2D',          badge: null,       init: 399, home: [79, 99, 149],  yard: [99, 119, 169],  termite: [999, 49],
    addons: [['tfm', 100, 50], ['mole', 100, 50], ['seasonal', 100, 45], ['pest', 100, 30], ['rodent', 100, 30], ['snake', 100, 30], ['cbee', 100, 30], ['roach', 200, 30], ['flea', 200, 30]], onetime: false },
  { id: 'd2d_min',  label: 'D2D',          badge: 'Minimums', init: 99,  home: [49, 69, 119],  yard: [69, 89, 139],   termite: [399, 29],
    addons: [['tfm', 0, 40], ['mole', 0, 40], ['seasonal', 0, 30], ['pest', 0, 20], ['rodent', 0, 20], ['snake', 0, 20], ['cbee', 0, 20], ['roach', 200, 20], ['flea', 200, 20]], onetime: false },
  { id: 'standard', label: 'Standard',     badge: 'Standard', init: 99,  home: [49, 69, 119],  yard: [69, 89, 139],   termite: [399, 29],
    addons: [['tfm', 0, 40], ['mole', 0, 40], ['seasonal', 0, 30], ['pest', 0, 20], ['rodent', 0, 20], ['snake', 0, 20], ['cbee', 0, 20], ['roach', 200, 20], ['flea', 200, 20]], onetime: true },
  { id: 'loyalty',  label: 'Loyalty',      badge: 'Loyalty Pricing', init: 99, home: [29, 49, 99], yard: [49, 69, 119], termite: [399, 29],
    addons: [['tfm', 0, 30], ['mole', 0, 30], ['seasonal', 0, 15], ['pest', 0, 10], ['rodent', 0, 10], ['snake', 0, 10], ['cbee', 0, 10], ['roach', 200, 10], ['flea', 200, 10]], onetime: true },
];
const PRICING_SERVICES = {
  pest:     { label: 'Pest',                    program: 'home' },
  rodent:   { label: 'Rodent',                  program: 'home' },
  tfm:      { label: 'Tick, Flea & Mosquito',   program: 'yard' },
  mole:     { label: 'Mole',                    program: 'yard' },
  termite:  { label: 'Termite',                 program: 'termite' },
  seasonal: { label: 'Seasonal Mosquito' },
  snake:    { label: 'Snake' },
  cbee:     { label: 'Carpenter Bee' },
  roach:    { label: 'German Roach' },
  flea:     { label: 'Interior Flea' },
};
const PRICING_PROGRAMS = [
  { id: 'home',    label: 'Home Essentials', services: ['pest', 'rodent'] },
  { id: 'yard',    label: 'Yard Essentials', services: ['tfm', 'mole'] },
  { id: 'termite', label: 'Termite Defense', services: ['termite'] },
];
// Program glyphs — flat orange silhouettes in the same cut as the RIDD spider mark.
const PRICING_ICONS = {
  home:    'M12 2.5 L22.5 11.5 L19.5 11.5 L19.5 21.5 L4.5 21.5 L4.5 11.5 L1.5 11.5 Z M10 21.5 L14 21.5 L14 14 L10 14 Z',
  yard:    'M1 22 L23 22 L23 19.6 L1 19.6 Z M3 18.4 C3 13.5 1.6 10.8 0.6 8.6 C4.2 10.4 6.3 14 6.3 18.4 Z M7 18.4 C7 11.5 8.6 6.8 12 2 C12.6 8.5 11.4 13.6 10.2 18.4 Z M11.4 18.4 C12.6 13.2 15.4 9.4 18.6 7.2 C17.6 12.3 16.2 15.5 14.6 18.4 Z M16.6 18.4 C17.2 14.6 19.6 12.2 23.4 11 C22.2 14.3 20.6 16.8 19.4 18.4 Z',
  termite: 'M8.3 5.2 A3.7 3.4 0 1 1 15.7 5.2 A3.7 3.4 0 1 1 8.3 5.2 Z M9.6 2.4 L7.4 0 L6.3 1 L8.4 3.3 Z M14.4 2.4 L16.6 0 L17.7 1 L15.6 3.3 Z M9.2 9 L14.8 9 L14.8 13 L9.2 13 Z M8.8 13.6 L15.2 13.6 L15.2 20.6 L12 23.6 L8.8 20.6 Z M8.9 9.6 L2.6 7.4 L2 8.9 L8.6 11.2 Z M15.1 9.6 L21.4 7.4 L22 8.9 L15.4 11.2 Z M8.9 11.8 L2.2 12.6 L2.3 14.2 L8.9 13.4 Z M15.1 11.8 L21.8 12.6 L21.7 14.2 L15.1 13.4 Z M8.9 14.4 L3 18.2 L3.8 19.6 L9.2 16.1 Z M15.1 14.4 L21 18.2 L20.2 19.6 L14.8 16.1 Z',
};
function pricingIcon(id, px, color) {
  const ns = 'http://www.w3.org/2000/svg';
  const s = document.createElementNS(ns, 'svg');
  s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('width', px); s.setAttribute('height', px); s.setAttribute('aria-hidden', 'true');
  const p = document.createElementNS(ns, 'path');
  p.setAttribute('d', PRICING_ICONS[id] || ''); p.setAttribute('fill', color); p.setAttribute('fill-rule', 'evenodd');
  s.append(p); s.style.cssText = 'display:block;flex-shrink:0';
  return s;
}
const PRICING_FREQ = [['q', 'Quarterly', 4], ['b', 'Bi-Monthly', 6], ['m', 'Monthly', 12]];
// One-time services (Standard + Loyalty only) — New customer / Current customer.
const PRICING_ONETIME = [
  ['ot_tfm',     'Tick, Flea & Mosquito', 199, 99],
  ['ot_pest',    'Pest',                  199, 99],
  ['ot_termite', 'Termite Inspection',    199, 99],
  ['ot_rodent',  'Rodent',                249, 149],
  ['ot_roach',   'German Roach',          299, 199],
  ['ot_flea',    'Interior Flea',         299, 199],
  ['ot_sedan',   'Vehicle — Sedan',       199, 199],
  ['ot_suv',     'Vehicle — SUV',         249, 249],
];

// Which tier opens first for this user (per Isaac).
function pricingDefaultTier(profile) {
  const role = String(profile?.role || '');
  if (/loyalty/.test(role)) return 'loyalty';
  if (role === 'rep_sales' || role === 'rep_partner' || role === 'rep_team_lead') return 'd2d';
  if (typeof isOfficeStaffProfile === 'function' && !isAdminRole(role) && !isOfficeStaffProfile(profile)) return 'd2d';
  return 'standard';
}

// Sales-rep user types only ever see the D2D slick (per Isaac); everyone
// else can switch tiers from the badge bubble on the board.
function pricingLockedToD2D(profile) {
  const role = String(profile?.role || '');
  if (role === 'rep_sales' || role === 'rep_partner' || role === 'rep_team_lead') return true;
  if (typeof isOfficeStaffProfile === 'function' && !isAdminRole(role) && !isOfficeStaffProfile(profile)) return true;
  return false;
}

function pricingStore() {
  state.modules = state.modules || {};
  const st = (state.modules.pricing = state.modules.pricing || {});
  if (!st.tier) st.tier = pricingDefaultTier(state.profile);
  if (st.tier === 'd2d_min') { st.tier = 'd2d'; st.min = true; }   // legacy value from an earlier build
  if (st.min == null) st.min = false;
  if (pricingLockedToD2D(state.profile)) st.tier = 'd2d';
  // Termite Defense is its own subscription in the CRM (per Isaac): it sits
  // ALONGSIDE whichever Home/Yard base plan is picked, never instead of it.
  if (st.termite == null) st.termite = false;
  if (st.base === 'termite') { st.base = 'pest'; st.termite = true; }   // legacy value from an earlier build
  // st.base may be null: nothing picked yet. Add-ons need a Home/Yard base
  // plan; Termite Defense can stand alone; one-time services (Standard /
  // Loyalty) can stand alone too.
  if (st.base && (!PRICING_SERVICES[st.base] || PRICING_SERVICES[st.base].program === 'termite')) st.base = null;
  if (!st.base) st.addons = {};
  if (!st.freq) st.freq = 'q';
  if (!st.addons) st.addons = {};
  if (!st.onetime) st.onetime = {};
  if (!st.customer) st.customer = 'new';
  // Custom (rep-entered) prices, keyed by receipt line — D2D only, and never
  // below the D2D minimums (per Isaac). Dropped when the line leaves the quote.
  if (!st.custom) st.custom = {};
  if (st.custom.base && st.custom.base.for !== st.base + ':' + st.freq) delete st.custom.base;
  for (const k of Object.keys(st.custom)) { if (k.startsWith('addon:') && !st.addons[k.slice(6)]) delete st.custom[k]; }
  if (!st.termite) delete st.custom.termite;
  return st;
}
// The D2D floor for a receipt line — the number a rep can never quote under.
// It is the D2D minimum, or this tier's own list price when that is lower
// (Loyalty sits under the D2D minimums by design).
function pricingFloor(st, key) {
  const fi = Math.max(0, PRICING_FREQ.findIndex(([k]) => k === st.freq));
  const one = (T) => {
    if (key === 'base') { const svc = PRICING_SERVICES[st.base]; return svc ? { init: T.init, mo: T[svc.program][fi] } : null; }
    if (key === 'termite') return { init: T.termite[0], mo: T.termite[1] };
    if (key.startsWith('addon:')) { const a = T.addons.find(x => x[0] === key.slice(6)); return a ? { init: a[1], mo: a[2] } : null; }
    return null;
  };
  const m = one(PRICING_TIERS.find(t => t.id === 'd2d_min')), l = one(pricingTierOf(st));
  if (!m || !l) return m || l;
  return { init: Math.min(m.init, l.init), mo: Math.min(m.mo, l.mo) };
}

// The tier whose NUMBERS apply: D2D with the Ⓜ toggle on = D2D minimums.
function pricingTierOf(st) {
  const id = st.tier === 'd2d' && st.min ? 'd2d_min' : st.tier;
  return PRICING_TIERS.find(t => t.id === id) || PRICING_TIERS[0];
}
function pricingQuote(st) {
  const T = pricingTierOf(st);
  const svc = st.base ? PRICING_SERVICES[st.base] : null;
  const fi = Math.max(0, PRICING_FREQ.findIndex(([k]) => k === st.freq));
  const lines = [];
  if (svc) {
    lines.push({ key: 'base', kind: 'base', label: (PRICING_PROGRAMS.find(p => p.id === svc.program) || {}).label + ' · ' + svc.label, sub: PRICING_FREQ[fi][1] + ' · base plan', init: T.init, mo: T[svc.program][fi] });
    for (const [id, init, mo] of T.addons) {
      if (id === st.base || !st.addons[id]) continue;
      lines.push({ key: 'addon:' + id, kind: 'addon', label: PRICING_SERVICES[id].label, sub: 'add-on', init, mo });
    }
  }
  if (st.termite) lines.push({ key: 'termite', kind: 'termite', label: 'Termite Defense', sub: 'annual · separate subscription', init: T.termite[0], mo: T.termite[1] });
  // Rep-entered custom prices replace the list price on a line —
  // but pricingFloor() is the hard floor, so anything under it is ignored.
  for (const l of lines) {
    const c = st.custom[l.key], f = pricingFloor(st, l.key);
    if (!c || !f || c.init < f.init || c.mo < f.mo) continue;
    l.list = { init: l.init, mo: l.mo }; l.init = c.init; l.mo = c.mo; l.custom = true;
  }
  if (T.onetime) for (const [id, label, nw, cur] of PRICING_ONETIME) {
    if (!st.onetime[id]) continue;
    lines.push({ kind: 'onetime', label, sub: 'one-time · ' + (st.customer === 'current' ? 'current customer' : 'new customer'), init: st.customer === 'current' ? cur : nw, mo: 0 });
  }
  const init = lines.reduce((a, l) => a + l.init, 0), mo = lines.reduce((a, l) => a + l.mo, 0);
  // Sellable = at least one base (Home/Yard plan or Termite Defense), or —
  // Standard/Loyalty only — a one-time service on its own.
  const hasBase = !!svc || !!st.termite;
  const hasOneTime = lines.some(l => l.kind === 'onetime');
  const ok = hasBase || (T.onetime && hasOneTime);
  return { tier: T, lines, init, mo, acv: init + mo * 11, ok, hasBase, empty: lines.length === 0 };
}

// Bundle & Save (per Isaac's savings table): standalone plan ACV (11 × monthly
// + initial) minus add-on ACV (12 × add-on monthly + add-on initial), per tier.
function pricingSavings(T, svc, fi) {
  const prog = PRICING_SERVICES[svc].program;
  const standalone = T[prog][fi] * 11 + T.init;
  const a = T.addons.find(x => x[0] === svc);
  return standalone - (a[2] * 12 + a[1]);
}

// ── The slick, live. Same card the reps carry (brand palette, program blocks
// on top, add-ons / one-time / bundle & save below) — but every tile and row
// is a control. Re-renders ITSELF on every click (no mountApp), so the page
// never flashes and scroll stays put (per Isaac).
function viewPricing() {
  _load();
  // Phone: quote pinned on top, slick below. Desktop (≥1024px): the slick
  // keeps its 760px column and the quote rides alongside on the right
  // (sticky), so far more of the card fits on screen (per Isaac). Layout
  // rules live in index.html (.pricing-layout / .pricing-quote).
  const root = el('div', { class: 'w-full mx-auto pricing-layout' });
  const money = (v) => '$' + Math.round(v).toLocaleString();
  let editKey = null;   // receipt line whose price is being typed in
  const C = { sage: '#5F6C5B', cream: '#FBF4DA', cream2: '#F3EBCD', char: '#323230', orange: '#DF643A', ink2: '#5A5A56', ink3: '#8C8A80' };
  const render = () => {
    const st = pricingStore();
    const T = pricingTierOf(st);
    const isMin = T.id !== 'd2d';
    const PICK = PRICING_TIERS.filter(t => t.id !== 'd2d_min');   // three choices; minimums is the Ⓜ toggle on D2D
    const price = isMin ? { color: C.orange } : { color: C.char };
    const baseSvc = st.base ? PRICING_SERVICES[st.base] : null;
    const hasPlan = !!baseSvc;
    const fi = Math.max(0, PRICING_FREQ.findIndex(([k]) => k === st.freq));
    const q = pricingQuote(st);
    const rerender = () => { const y = window.scrollY; _save(); render(); window.scrollTo(0, y); };

    // ── tier switch lives IN the badge bubble on the board (no separate
    // "change" bar — most users never switch). Sales reps are locked to D2D,
    // so for them the bubble is just a label.
    const locked = pricingLockedToD2D(state.profile);
    const isAdmin = typeof isAdminRole === 'function' && isAdminRole(String(state.profile?.role || ''));
    const sel = locked ? null : el('select', {
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' },
      'aria-label': 'Pricing tier',
      title: 'Switch pricing tier',
      onchange: (e) => { const t = PICK.find(x => x.id === e.target.value); if (!t) return; st.tier = t.id; if (!t.onetime) st.onetime = {}; rerender(); },
    }, ...PICK.map(t => el('option', { value: t.id, selected: t.id === st.tier }, t.label)));
    // Ⓜ — D2D only: flips the card to minimum pricing (per Isaac). Sits just
    // left of the D2D bubble in the ribbon.
    const mBtn = st.tier === 'd2d' ? el('button', {
      title: st.min ? 'Showing minimums — tap for display pricing' : 'Tap for minimum pricing',
      'aria-pressed': st.min ? 'true' : 'false',
      class: 'inline-flex items-center justify-center font-black transition',
      style: { width: '28px', height: '28px', borderRadius: '50%', border: '2px solid ' + (st.min ? C.orange : 'rgba(251,244,218,.6)'), background: st.min ? C.orange : 'transparent', color: C.cream, fontSize: '13px', lineHeight: 1, flexShrink: 0 },
      onclick: (e) => { e.stopPropagation(); st.min = !st.min; rerender(); },
    }, 'M') : null;

    // ── card primitives (brand look, fixed colours — the slick doesn't theme) ──
    const card = (...kids) => el('div', { style: { background: C.cream, borderRadius: '12px', overflow: 'hidden', color: C.char } }, ...kids);
    const secH = (title, sub, extra) => el('div', { class: 'flex items-baseline justify-between gap-3 flex-wrap', style: { padding: '12px 16px 4px' } },
      el('div', { class: 'flex items-baseline gap-3 flex-wrap' },
        el('div', { style: { font: '700 14px/1 Archivo, "Helvetica Neue", Arial, sans-serif', textTransform: 'uppercase', color: C.char } }, title),
        extra || null),
      sub ? el('div', { style: { font: '400 9px/1.2 Archivo, Arial, sans-serif', color: C.ink2, textAlign: 'right' } }, sub) : null);
    const pill = (txt, on, onclick) => el('button', { onclick, style: { background: on ? C.orange : 'transparent', color: on ? C.cream : C.char, border: '1.5px solid ' + (on ? C.orange : C.ink3), font: '700 10px/1 Archivo, Arial, sans-serif', letterSpacing: '.08em', textTransform: 'uppercase', padding: '6px 10px', borderRadius: '999px', cursor: 'pointer' } }, txt);
    // Selected tile = solid orange with cream type (per Isaac), not just an outline.
    const tile = (label, sub, val, on, onclick, o = {}) => {
      const inv = o.dark || on;                                   // inverted (light-on-dark) type
      const dim = o.dark ? 'rgba(251,244,218,.7)' : 'rgba(251,244,218,.85)';
      return el('button', { onclick, 'aria-pressed': on ? 'true' : 'false', style: { background: o.dark ? C.char : (on ? C.orange : C.cream2), color: inv ? C.cream : C.char, borderRadius: '10px', padding: '9px 10px 8px', textAlign: 'center', border: '2px solid ' + (on ? C.orange : 'transparent'), cursor: onclick ? 'pointer' : 'default', minWidth: 0, boxShadow: on ? '0 6px 16px -8px rgba(223,100,58,.7)' : 'none' } },
        el('div', { style: { font: '700 10px/1 Archivo, Arial, sans-serif', letterSpacing: '.14em', textTransform: 'uppercase', color: inv ? dim : C.ink2 } }, label),
        el('div', { style: { fontSize: '9.5px', color: inv ? dim : C.ink3, marginTop: '3px' } }, sub),
        el('div', { style: { marginTop: '6px', font: '700 26px/1 Archivo, Arial, sans-serif', letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: o.dark ? (isMin ? C.orange : C.cream) : (on ? C.cream : price.color) } }, money(val), o.mo ? el('span', { style: { font: '500 10px/1 Archivo, Arial, sans-serif', color: inv ? dim : C.ink2, marginLeft: '2px' } }, '/mo') : null));
    };

    // ── program blocks (Home · Yard · Termite) ──
    const program = (p) => {
      const isT = p.id === 'termite';
      const onProg = isT ? !!st.termite : (!!baseSvc && baseSvc.program === p.id);
      const toggleT = () => { st.termite = !st.termite; rerender(); };
      const initV = isT ? T.termite[0] : T.init;
      return card(
        el('div', { class: 'flex items-center justify-between gap-3 flex-wrap', style: { padding: '14px 18px 6px' } },
          el('div', { class: 'flex items-center gap-2', style: { font: '700 20px/1 Archivo, Arial, sans-serif', letterSpacing: '-.01em', textTransform: 'uppercase' } }, pricingIcon(p.id, 22, C.orange), p.label),
          isT
            ? el('div', { class: 'flex items-center gap-2' },
                pill(st.termite ? 'Added ✓' : 'Add', !!st.termite, toggleT))
            : el('div', { class: 'flex gap-1.5 flex-wrap' }, ...p.services.map(sid => pill(PRICING_SERVICES[sid].label, st.base === sid, () => { if (st.base === sid) { st.base = null; st.addons = {}; } else { st.base = sid; delete st.addons[sid]; } rerender(); })))),
        el('div', { class: 'grid gap-2', style: { gridTemplateColumns: isT ? '1fr 1fr' : '1.05fr 1fr 1fr 1fr', padding: '6px 14px 12px' } },
          tile('Initial', 'first visit', initV, false, null, { dark: true }),
          ...(isT
            ? [tile('Annual', 'serviced once a year · tap to add', T.termite[1], onProg, toggleT, { mo: true })]
            : PRICING_FREQ.map(([k, lbl, visits], i) => tile(lbl, visits + ' visits', T[p.id][i], onProg && st.freq === k, () => { if (onProg && st.freq === k) { st.base = null; st.addons = {}; } else { if (!onProg) { st.base = p.services[0]; delete st.addons[st.base]; } st.freq = k; } rerender(); }, { mo: true })))));
    };

    // ── add-ons table (rows are toggles) ──
    const box = (on) => el('span', { style: { display: 'inline-flex', width: '14px', height: '14px', borderRadius: '3px', border: '1.5px solid ' + (on ? C.orange : C.ink3), background: on ? C.orange : 'transparent', color: C.cream, font: '900 10px/14px Archivo, Arial, sans-serif', justifyContent: 'center', alignItems: 'center', marginRight: '8px', flexShrink: 0 } }, on ? '✓' : '');
    const trow = (cells, on, onclick, i) => el('tr', { onclick, style: { cursor: onclick ? 'pointer' : 'default', background: on ? 'rgba(223,100,58,.14)' : (i % 2 === 0 ? C.cream2 : C.cream) } },
      ...cells.map((c, j) => el('td', { style: { padding: '5px 8px', fontSize: '11px', textAlign: j === 0 ? 'left' : 'center', fontWeight: j === 0 ? 500 : 700, fontVariantNumeric: 'tabular-nums', color: j === 0 ? C.char : price.color, borderRadius: j === 0 ? '6px 0 0 6px' : (j === cells.length - 1 ? '0 6px 6px 0' : '0'), whiteSpace: 'nowrap' } }, c)));
    const thead = (cols) => el('thead', {}, el('tr', {}, ...cols.map((c, j) => el('th', { style: { padding: '4px 8px 2px', fontSize: '10px', letterSpacing: '.04em', textTransform: 'uppercase', color: C.ink2, fontWeight: 500, textAlign: j === 0 ? 'left' : 'center' } }, c))));
    const table = (cols, rows) => el('table', { style: { width: '100%', borderCollapse: 'separate', borderSpacing: '0 3px', padding: '4px 8px 8px' } }, thead(cols), el('tbody', {}, ...rows));
    const addonsCard = card(
      secH('Add-Ons', null),
      el('div', { style: hasPlan ? {} : { opacity: '.45' } },
        table(['Add-On Service', 'Initial', 'Monthly'],
          // Every add-on row always renders (the base plan's own row just
          // dims) so the card never changes height and nothing below it
          // shifts when a plan is picked (per Isaac).
          T.addons.map(([id, init, mo], i) => {
            const isBase = id === st.base;
            const on = !isBase && !!st.addons[id];
            const row = trow([el('span', { class: 'inline-flex items-center' }, box(on), PRICING_SERVICES[id].label + (isBase ? ' · your base plan' : '')), money(init), '+' + money(mo)], on, (hasPlan && !isBase) ? () => { if (on) delete st.addons[id]; else st.addons[id] = true; rerender(); } : null, i);
            if (isBase) row.style.opacity = '.4';
            return row;
          }))));

    // ── one-time (Standard / Loyalty) ──
    const oneTimeCard = T.onetime ? card(
      secH('One-Time Services', null, el('div', { class: 'inline-flex rounded-full overflow-hidden', style: { border: '1.5px solid ' + C.ink3 } },
        ...[['new', 'New'], ['current', 'Current']].map(([v, l]) => el('button', { onclick: () => { st.customer = v; rerender(); }, style: { padding: '3px 10px', font: '700 9px/1.4 Archivo, Arial, sans-serif', letterSpacing: '.08em', textTransform: 'uppercase', background: st.customer === v ? C.orange : 'transparent', color: st.customer === v ? C.cream : C.char, border: 0, cursor: 'pointer' } }, l)))),
      table(['Service', 'New', 'Current'],
        PRICING_ONETIME.map(([id, label, nw, cur], i) => {
          const on = !!st.onetime[id];
          return trow([el('span', { class: 'inline-flex items-center' }, box(on), label), money(nw), money(cur)], on, () => { if (on) delete st.onetime[id]; else st.onetime[id] = true; rerender(); }, i);
        }))) : null;

    // ── bundle & save (informational, computed from this tier's numbers) ──
    const saveCard = card(
      secH('Bundle & Save', 'Annual savings vs buying separately'),
      table(['Plan', '+ TFM', '+ Mole', '+ Rodent'],
        PRICING_FREQ.map(([k, lbl], i) => trow([lbl, money(pricingSavings(T, 'tfm', i)), money(pricingSavings(T, 'mole', i)), money(pricingSavings(T, 'rodent', i))], false, null, i))));

    // ── chips + reviews (D2D cards) ──
    const chip = (big, txt, sub) => el('div', { style: { background: C.cream, borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '14px', minHeight: '76px' } },
      el('div', { style: { font: '700 ' + (big.length > 2 ? '30px' : '40px') + '/1 Archivo, Arial, sans-serif', color: C.orange, flexShrink: 0, letterSpacing: '-.02em' } }, big),
      el('div', { style: { minWidth: 0 } },
        el('div', { style: { font: 'italic 700 16px/1.15 Archivo, Arial, sans-serif', color: C.char } }, txt),
        sub ? el('div', { style: { font: '400 11px/1.25 Archivo, Arial, sans-serif', marginTop: '3px', color: C.ink2 } }, sub) : null));
    // Stretches to fill whatever height the add-ons column leaves (per Isaac).
    const reviews = el('div', { style: { background: C.cream, borderRadius: '12px', padding: '18px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', justifyContent: 'center', flex: '1 1 auto', minHeight: '150px' } },
      el('span', { style: { width: '40px', height: '40px', borderRadius: '50%', background: C.char, color: C.cream, font: '700 22px/40px Archivo, Arial, sans-serif', display: 'inline-block' } }, 'G'),
      el('span', { style: { color: C.orange, fontSize: '22px', letterSpacing: '.08em', lineHeight: 1 } }, '★★★★★'),
      el('b', { style: { font: '700 14px/1.2 Archivo, Arial, sans-serif', color: C.char } }, 'Over 15,000+ Google Reviews'),
      el('small', { style: { font: '500 9px/1 Archivo, Arial, sans-serif', color: C.ink2, letterSpacing: '.12em', textTransform: 'uppercase' } }, '5-star rated'));

    // ── the board ──
    const ribbon = el('div', { class: 'flex items-center justify-between gap-3', style: { padding: '14px 24px', borderBottom: '1px solid rgba(251,244,218,.18)' } },
      typeof riddSpiderMark === 'function' ? riddSpiderMark(28) : el('span', {}, ''),
      el('div', { style: { font: '700 16px/1 Archivo, Arial, sans-serif', letterSpacing: '.3em', textTransform: 'uppercase', color: C.cream } }, 'Pricing'),
      // Admins get every slick as its own bubble (per Isaac); office/loyalty
      // users get one bubble with a dropdown; sales reps get a plain D2D label.
      isAdmin
        ? el('div', { class: 'flex items-center gap-1.5 flex-wrap justify-end' },
            mBtn,
            ...PICK.map(t => el('button', {
              onclick: () => { if (st.tier === t.id) return; st.tier = t.id; if (!t.onetime) st.onetime = {}; editKey = null; rerender(); },
              'aria-pressed': st.tier === t.id ? 'true' : 'false',
              style: { background: st.tier === t.id ? C.orange : 'transparent', color: C.cream, border: '1.5px solid ' + (st.tier === t.id ? C.orange : 'rgba(251,244,218,.5)'), font: '700 10px/1 Archivo, Arial, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', padding: '6px 11px', borderRadius: '999px', cursor: 'pointer' },
            }, t.label)))
        : el('div', { class: 'flex items-center gap-2' },
            mBtn,
            el('span', { class: 'relative inline-flex items-center gap-1', style: { background: C.orange, color: C.cream, font: '700 10px/1 Archivo, Arial, sans-serif', letterSpacing: '.16em', textTransform: 'uppercase', padding: '7px 12px', borderRadius: '999px', cursor: locked ? 'default' : 'pointer' } },
              st.tier === 'd2d' ? 'D2D' : T.badge,
              locked ? null : el('span', { style: { opacity: '.8', letterSpacing: 0 } }, '▾'),
              sel)));
    const board = el('div', { style: { background: C.sage, borderRadius: '14px', overflow: 'hidden' } },
      ribbon,
      el('div', { class: 'flex flex-col gap-3', style: { padding: '18px 24px 24px' } },
        ...PRICING_PROGRAMS.map(program),
        el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' } },
          addonsCard,
          el('div', { class: 'flex flex-col gap-3' }, oneTimeCard, saveCard, T.onetime ? null : reviews)),
        el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' } },
          chip('🐾', 'Kid & Pet Safe'), chip('100%', 'Satisfaction Guarantee', 'Backed by unlimited free re-services'), chip('✓', 'Licensed & Insured'))));

    // ── quote, laid out like a receipt in the slick's cream (per Isaac) ──
    // Every line has a pencil: tap it to type a custom initial / monthly.
    // The floor (D2D minimum, or the tier's list price if lower) is hard —
    // anything under it is refused with the floor shown, so nobody sets an
    // expectation the office can't honor (per Isaac).
    const F = 'Archivo, Arial, sans-serif';
    const pencil = () => { const ns = 'http://www.w3.org/2000/svg'; const sv = document.createElementNS(ns, 'svg'); sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('width', 13); sv.setAttribute('height', 13); sv.setAttribute('fill', 'none'); sv.setAttribute('stroke', 'currentColor'); sv.setAttribute('stroke-width', '2.2'); sv.setAttribute('stroke-linecap', 'round'); sv.setAttribute('stroke-linejoin', 'round'); sv.innerHTML = '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>'; return sv; };
    const priceCol = (l) => el('div', { style: { textAlign: 'right', flexShrink: 0, fontVariantNumeric: 'tabular-nums' } },
      el('div', { style: { font: '700 13px/1.2 ' + F, color: C.char } }, money(l.init), el('span', { style: { font: '500 10px/1 ' + F, color: C.ink2 } }, ' initial')),
      l.mo ? el('div', { style: { font: '700 12px/1.2 ' + F, color: C.orange } }, '+' + money(l.mo) + '/mo') : el('div', { style: { font: '500 10px/1.2 ' + F, color: C.ink3 } }, 'no monthly'),
      l.custom ? el('div', { style: { font: '700 8px/1.4 ' + F, letterSpacing: '.1em', textTransform: 'uppercase', color: C.orange } }, 'custom · list ' + money(l.list.init) + ' / ' + money(l.list.mo)) : null);
    const editor = (l) => {
      const f = pricingFloor(st, l.key) || { init: 0, mo: 0 };
      const cur = st.custom[l.key] || { init: l.init, mo: l.mo };
      const inp = (v, ph) => el('input', { type: 'number', inputmode: 'numeric', min: 0, step: 1, value: v, placeholder: ph, style: { width: '68px', padding: '5px 8px', borderRadius: '8px', border: '1.5px solid ' + C.ink3, background: '#fff', color: C.char, font: '700 12px/1.2 ' + F, textAlign: 'right', fontVariantNumeric: 'tabular-nums' } });
      const iIn = inp(cur.init, 'initial'), mIn = inp(cur.mo, 'monthly');
      const err = el('div', { style: { font: '700 10px/1.3 ' + F, color: '#C0392B', minHeight: '13px', textAlign: 'right' } }, '');
      const check = () => {
        const i = Number(iIn.value), m = Number(mIn.value);
        const badI = !(i >= f.init), badM = !(m >= f.mo);
        iIn.style.borderColor = badI ? '#C0392B' : C.ink3; mIn.style.borderColor = badM ? '#C0392B' : C.ink3;
        err.textContent = (badI || badM) ? 'Below minimum — floor is ' + money(f.init) + ' initial / ' + money(f.mo) + '/mo' : '';
        return !(badI || badM);
      };
      const save = () => { if (!check()) { (Number(iIn.value) >= f.init ? mIn : iIn).focus(); return; } st.custom[l.key] = { init: Math.round(Number(iIn.value)), mo: Math.round(Number(mIn.value)), for: st.base + ':' + st.freq }; editKey = null; rerender(); };
      const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } else if (e.key === 'Escape') { editKey = null; rerender(); } };
      iIn.oninput = check; mIn.oninput = check; iIn.onkeydown = onKey; mIn.onkeydown = onKey;
      const btn = (t, fn, primary) => el('button', { onclick: fn, style: { padding: '5px 10px', borderRadius: '999px', font: '700 9px/1.2 ' + F, letterSpacing: '.08em', textTransform: 'uppercase', cursor: 'pointer', border: '1.5px solid ' + (primary ? C.orange : C.ink3), background: primary ? C.orange : 'transparent', color: primary ? C.cream : C.char } }, t);
      const wrap = el('div', { style: { flex: '0 0 auto', marginLeft: 'auto', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '4px' } },
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '4px' } }, iIn, el('span', { style: { font: '500 10px/1 ' + F, color: C.ink2 } }, 'init'), mIn, el('span', { style: { font: '500 10px/1 ' + F, color: C.ink2 } }, '/mo')),
        err,
        el('div', { style: { display: 'flex', gap: '4px' } }, btn('Save', save, true), st.custom[l.key] ? btn('List price', () => { delete st.custom[l.key]; editKey = null; rerender(); }) : null, btn('Cancel', () => { editKey = null; rerender(); })));
      setTimeout(() => iIn.focus(), 0);
      return wrap;
    };
    const rline = (l) => {
      const editable = !!l.key;
      const editing = editable && editKey === l.key;
      // While editing, the fields drop onto their own full-width row so the
      // service name never gets squeezed (per Isaac).
      return el('div', { style: { display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: '6px 10px', padding: '7px 0', borderBottom: '1px dashed rgba(50,50,48,.28)' } },
        el('div', { style: { minWidth: 0, flex: '1 1 160px' } },
          el('div', { style: { font: '700 13px/1.2 ' + F, color: C.char, textTransform: 'uppercase', letterSpacing: '.01em', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: editing ? 'normal' : 'nowrap' } }, l.label),
          el('div', { style: { font: '500 10px/1.3 ' + F, color: C.ink2, marginTop: '1px' } }, l.sub)),
        editing ? editor(l) : el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 } },
          priceCol(l),
          editable ? el('button', { title: 'Custom price for this line', 'aria-label': 'Edit price', onclick: () => { editKey = l.key; rerender(); }, style: { width: '26px', height: '26px', borderRadius: '50%', border: '1.5px solid ' + C.ink3, background: 'transparent', color: C.char, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 } }, pencil()) : null));
    };
    const total = (lbl, val, o = {}) => el(o.onclick ? 'button' : 'div', { onclick: o.onclick, title: o.title, style: { display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '12px', width: '100%', textAlign: 'left', cursor: o.onclick ? 'pointer' : 'default', background: 'transparent', border: 0, padding: 0, color: 'inherit' } },
      el('span', { style: { font: '700 9px/1 ' + F, letterSpacing: '.14em', textTransform: 'uppercase', color: o.accent ? C.orange : 'rgba(251,244,218,.7)' } }, lbl),
      el('span', { style: { font: '700 ' + (o.big ? '24px' : '14px') + '/1.1 ' + F, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: o.accent ? C.orange : C.cream } }, val));
    const quote = el('div', { class: 'mb-3', style: { background: C.cream, color: C.char, borderRadius: '12px', padding: '12px 14px', boxShadow: 'var(--shadow-lg)', border: '1.5px solid ' + C.orange } },
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' } },
        el('div', { style: { font: '700 10px/1 ' + F, letterSpacing: '.16em', textTransform: 'uppercase', color: C.ink2 } }, 'Quote · ' + (st.tier === 'd2d' ? (st.min ? 'D2D minimums' : 'D2D') : T.label)),
        el('button', { style: { padding: '5px 12px', borderRadius: '999px', border: '1.5px solid ' + C.ink3, background: 'transparent', color: C.char, font: '700 9px/1.2 ' + F, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }, onclick: () => { st.base = null; st.addons = {}; st.onetime = {}; st.termite = false; st.custom = {}; editKey = null; rerender(); } }, 'Reset')),
      el('div', { class: 'grid gap-3 items-start pricing-qgrid', style: { gridTemplateColumns: 'minmax(0, 1fr) auto' } },
        el('div', { style: { minWidth: 0 } }, ...(q.empty ? [el('div', { style: { font: '500 11px/1.4 ' + F, color: C.ink3, padding: '8px 0' } }, 'Nothing selected yet.')] : q.lines.map(rline))),
        el('div', { style: { background: C.char, color: C.cream, borderRadius: '10px', padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '7px', flexShrink: 0, minWidth: '150px', opacity: q.ok ? 1 : .55 } },
          total('Initial', money(q.init), { big: true }),
          // D2D: first-year cost is tucked away — tap Monthly to flip it into
          // view, tap again to hide (per Isaac). Standard / Loyalty show it.
          ...(st.tier === 'd2d'
            ? [total('Monthly', money(q.mo) + '/mo', { accent: true, title: st.showAcv ? 'Tap to hide first-year cost' : 'Tap to show first-year cost', onclick: () => { st.showAcv = !st.showAcv; rerender(); } }),
               ...(st.showAcv ? [el('div', { style: { borderTop: '1px dashed rgba(251,244,218,.35)', margin: '1px 0' } }), total('First year', money(q.acv))] : [])]
            : [total('Monthly', money(q.mo) + '/mo', { accent: true }),
               el('div', { style: { borderTop: '1px dashed rgba(251,244,218,.35)', margin: '1px 0' } }),
               total('First year', money(q.acv))]))));

    // Picker + quote ride together as one sticky block pinned right under
    // the fixed page header (measured live — it's ~60px, not 76 — so the
    // block no longer floats mid-page and overlaps the slick). The block
    // paints the page background so nothing shows through the gaps.
    const hdrH = Number(global.__riddPricingHeaderOffset || 0);
    const top = el('div', { class: 'pricing-quote', style: { position: 'sticky', top: hdrH + 'px', zIndex: 5, background: 'var(--bg)', paddingTop: '2px', marginTop: '-2px' } }, quote);
    board.classList.add('pricing-board');
    quote.style.position = ''; quote.style.top = ''; quote.style.zIndex = '';
    root.replaceChildren(top, board);
  };
  render();
  return root;
}


// D2D only: keep the two D2D tiers, drop Standard / Loyalty and the one-time services table.
PRICING_TIERS.splice(2);
PRICING_ONETIME.splice(0);

// ── public API ──
global.RiddPricing = {
  TIERS: PRICING_TIERS, SERVICES: PRICING_SERVICES, PROGRAMS: PRICING_PROGRAMS, ONETIME: PRICING_ONETIME, FREQ: PRICING_FREQ,
  quote: pricingQuote, floor: pricingFloor, savings: pricingSavings,
  mount(container, opts = {}) {
    state.profile = { role: 'rep_sales' };   // D2D only — locked, no tier picker
    _persist = opts.persist !== false;
    global.__riddPricingHeaderOffset = Number(opts.headerOffsetPx || 0);
    if (!_persist) state.modules.pricing = {};
    const node = viewPricing();
    container.replaceChildren(node);
    return node;
  },
};
})(window);
