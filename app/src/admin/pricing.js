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
// Numbers mirror the printed slicks exactly. Edit here and the PDFs together. Standard + Loyalty match the
// RIDD_Price_Sheet_Letter Google Slides deck (Nov 23 2026): German Roach / Interior Flea add-on initial $299 / $199,
// Loyalty Mole / Tick, Flea & Mosquito add-ons +$20. D2D German Roach / Interior Flea add-on initial $499,
// $299 on D2D minimums (per Isaac, Nov 23).
const PRICING_TIERS = [
  { id: 'd2d',      label: 'D2D',          badge: null,       init: 399, home: [79, 99, 149],  yard: [99, 119, 169],  termite: [999, 49],
    addons: [['mole', 100, 50], ['tfm', 100, 50], ['seasonal', 100, 45], ['pest', 100, 30], ['snake', 100, 30], ['cbee', 100, 30], ['rodent', 100, 30], ['roach', 499, 30], ['flea', 499, 30]], onetime: false },
  { id: 'd2d_min',  label: 'D2D',          badge: 'Minimums', init: 99,  home: [49, 69, 119],  yard: [69, 89, 139],   termite: [399, 29],
    addons: [['mole', 0, 40], ['tfm', 0, 40], ['seasonal', 0, 30], ['pest', 0, 20], ['snake', 0, 20], ['cbee', 0, 20], ['rodent', 0, 20], ['roach', 299, 20], ['flea', 299, 20]], onetime: false },
  { id: 'standard', label: 'Standard',     badge: 'Standard', init: 99,  home: [49, 69, 119],  yard: [69, 89, 139],   termite: [399, 29],
    addons: [['mole', 0, 40], ['tfm', 0, 40], ['seasonal', 0, 30], ['pest', 0, 20], ['snake', 0, 20], ['cbee', 0, 20], ['rodent', 0, 20], ['roach', 299, 20], ['flea', 299, 20]], onetime: true },
  { id: 'loyalty',  label: 'Loyalty',      badge: 'Loyalty Pricing', init: 99, home: [29, 49, 99], yard: [49, 69, 119], termite: [399, 29],
    addons: [['mole', 0, 20], ['tfm', 0, 20], ['seasonal', 0, 15], ['pest', 0, 10], ['snake', 0, 10], ['cbee', 0, 10], ['rodent', 0, 10], ['roach', 199, 10], ['flea', 199, 10]], onetime: true },
];
const PRICING_SERVICES = {
  pest:     { label: 'Pest',                    program: 'home' },
  rodent:   { label: 'Rodent',                  program: 'home' },
  tfm:      { label: 'Tick, Flea, & Mosquito',  program: 'yard' },
  mole:     { label: 'Mole',                    program: 'yard' },
  termite:  { label: 'Termite',                 program: 'termite' },
  seasonal: { label: 'Seasonal Tick, Flea, & Mosquito' },
  snake:    { label: 'Snake' },
  cbee:     { label: 'Carpenter Bee' },
  roach:    { label: 'German Roach' },
  flea:     { label: 'Interior Flea' },
};
// Add-ons a base plan already includes (per Isaac, Sep 21): Tick, Flea &
// Mosquito covers mosquito season, so Seasonal Mosquito can't be sold on top
// of it. The row dims like the base plan's own row and drops off the quote.
const PRICING_COVERED = { tfm: ['seasonal'] };
const pricingCoveredBy = (base, id) => !!base && (id === base || (PRICING_COVERED[base] || []).includes(id));
const PRICING_PROGRAMS = [
  { id: 'home',    label: 'Home Essentials', services: ['pest', 'rodent'] },
  { id: 'yard',    label: 'Yard Essentials', services: ['tfm', 'mole'], show: ['mole', 'tfm'] },   // Mole listed on top (per Isaac, Nov 23); tapping a tile with nothing picked still starts on TFM
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
// One-time services (Standard + Loyalty only) — New customer / Existing customer (already on a plan).
// Order and wording follow the printed price sheet (Nov 2026); 0 = FREE.
const PRICING_ONETIME = [
  ['ot_termite', 'Termite Inspection',     199, 0],
  ['ot_tfm',     'Tick, Flea, & Mosquito', 199, 99],
  ['ot_pest',    'Pest',                   199, 99],
  ['ot_rodent',  'Rodent',                249, 149],
  ['ot_roach',   'German Roach',          299, 199],
  ['ot_flea',    'Interior Flea',         299, 199],
  ['ot_sedan',   'Vehicle — Sedan',       199, 199],
  ['ot_suv',     'Vehicle — SUV',         249, 249],
];

// Who sees which sheets (per Isaac, Nov 23): sales reps get D2D only (with the Ⓜ minimums toggle), office staff
// (loyalty included) get Standard + Loyalty, technicians get Standard only, admins get all three.
function pricingIsTechnician(profile) {
  const role = String(profile?.role || '');
  if (/^tech/.test(role)) return true;   // tech, tech_pro, tech_branch, tech_regional, tech_senior_lead
  try { const emp = typeof frRosterRowForProfile === 'function' ? frRosterRowForProfile(profile) : null; return !!(emp && emp.type_label && typeof crmSellerIs === 'function' && crmSellerIs('technician', emp.type_label)); } catch (e) { return false; }
}
function pricingIsSalesRep(profile) {
  const role = String(profile?.role || '');
  if (role === 'rep_sales' || role === 'rep_partner' || role === 'rep_team_lead') return true;
  if (pricingIsTechnician(profile)) return false;
  return typeof isOfficeStaffProfile === 'function' && !isAdminRole(role) && !isOfficeStaffProfile(profile);
}
function pricingTierChoices(profile) {
  const role = String(profile?.role || '');
  if (typeof isAdminRole === 'function' && isAdminRole(role)) return ['d2d', 'standard', 'loyalty'];
  if (pricingIsTechnician(profile)) return ['standard'];
  return pricingIsSalesRep(profile) ? ['d2d'] : ['standard', 'loyalty'];
}
// Which tier opens first: sales reps on D2D, loyalty reps on Loyalty, everyone else (technicians, office) on Standard.
function pricingDefaultTier(profile) {
  const role = String(profile?.role || '');
  if (pricingIsTechnician(profile)) return 'standard';
  if (/loyalty/.test(role)) return 'loyalty';
  if (pricingIsSalesRep(profile)) return 'd2d';
  return 'standard';
}

function pricingStore() {
  state.modules = state.modules || {};
  const st = (state.modules.pricing = state.modules.pricing || {});
  if (!st.tier) st.tier = pricingDefaultTier(state.profile);
  if (st.tier === 'd2d_min') { st.tier = 'd2d'; st.min = true; }   // legacy value from an earlier build
  if (st.min == null) st.min = false;
  // A saved choice this user can't see any more (sheets per role, Nov 23) falls back to their default.
  if (!pricingTierChoices(state.profile).includes(st.tier)) { st.tier = pricingDefaultTier(state.profile); st.min = false; }
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
  for (const id of Object.keys(st.addons)) { if (pricingCoveredBy(st.base, id)) delete st.addons[id]; }   // a base plan drops the add-ons it already covers
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
      if (pricingCoveredBy(st.base, id) || !st.addons[id]) continue;
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
    lines.push({ kind: 'onetime', label, sub: 'one-time · ' + (st.customer === 'current' ? 'existing customer' : 'new customer'), init: st.customer === 'current' ? cur : nw, mo: 0 });
  }
  const init = lines.reduce((a, l) => a + l.init, 0), mo = lines.reduce((a, l) => a + l.mo, 0);
  // Sellable = at least one base (Home/Yard plan or Termite Defense), or —
  // Standard/Loyalty only — a one-time service on its own.
  const hasBase = !!svc || !!st.termite;
  const hasOneTime = lines.some(l => l.kind === 'onetime');
  const ok = hasBase || (T.onetime && hasOneTime);
  // Annual savings (per Isaac, Sep 21): what the customer saves by bundling
  // vs buying each add-on as its own plan — same math as Bundle & Save
  // (standalone plan ACV − what the add-on actually costs on this quote),
  // summed over the add-ons that could have been sold as a plan.
  let savings = 0;
  for (const l of lines) {
    if (l.kind !== 'addon') continue;
    const id = l.key.slice(6), prog = PRICING_SERVICES[id].program;
    if (!prog || !T[prog]) continue;
    savings += (T[prog][fi] * 11 + T.init) - (l.mo * 12 + l.init);
  }
  return { tier: T, lines, init, mo, acv: init + mo * 11, savings: Math.max(0, savings), ok, hasBase, empty: lines.length === 0 };
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
  // Phone: quote pinned on top, slick below. Desktop (≥1024px): the slick
  // keeps its 760px column and the quote rides alongside on the right
  // (sticky), so far more of the card fits on screen (per Isaac). Layout
  // rules live in index.html (.pricing-layout / .pricing-quote).
  const root = el('div', { class: 'w-full mx-auto pricing-layout' });
  const money = (v) => '$' + Math.round(v).toLocaleString();
  let editKey = null;   // receipt line whose price is being typed in
  // Look of the printed price sheet (per Isaac, Nov 23 2026 — RIDD_Price_Sheet_Letter): white page, big
  // PRICE SHEET heading with the tier on an orange tag, stone cards with a thin ink border, dark-green price
  // tiles with light numbers, IBM Plex Mono for the small print (labels, "$99 initial", the tables) and the
  // RIDD wordmark + spider at the foot. Everything stays a control: tiles pick the plan, rows tick add-ons.
  const C = { page: '#FFFFFF', card: '#EFEFEA', line: '#2B2B29', green: '#4D574A', greenLine: '#2C3329', char: '#1C1C1A', cream: '#FAFAF7', cream2: '#E4E4DD', orange: '#D9480F', ink2: '#5A5A56', ink3: '#9A988F', light: '#F2F1EA' };
  const SANS = 'Archivo, "Helvetica Neue", Arial, sans-serif', MONO = '"IBM Plex Mono", "Courier New", ui-monospace, monospace';
  const render = () => {
    const st = pricingStore();
    if (!st.mode) st.mode = 'build';   // Build a plan opens first; the full price sheet is one tap away (per Isaac, Nov 23)
    // Landing on the builder with nothing picked starts on Home + Yard, the most popular package (the default most
    // customers keep).
    if (st.mode !== 'sheet' && !st.pkg && !st.base && !st.termite) { st.pkg = 'homeyard'; st.base = 'pest'; st.addons = { tfm: true }; }
    const T = pricingTierOf(st);
    const isMin = false;   // the sheet's numbers stay white on green, minimums included (per Isaac, Nov 23)
    const PICK = pricingTierChoices(state.profile).map(id => PRICING_TIERS.find(t => t.id === id));   // sheets this user may see (per Isaac, Nov 23); D2D minimums is the Ⓜ toggle
    const baseSvc = st.base ? PRICING_SERVICES[st.base] : null;
    const hasPlan = !!baseSvc;
    const q = pricingQuote(st);
    const rerender = () => { const y = window.scrollY; render(); window.scrollTo(0, y); onScroll(); };

    // ── tier switch: admins get every sheet as its own tag; office staff get one orange tag with a Standard /
    // Loyalty dropdown; sales reps (D2D) and technicians (Standard) see a plain label.
    const locked = PICK.length < 2;
    const isAdmin = typeof isAdminRole === 'function' && isAdminRole(String(state.profile?.role || ''));
    const sel = locked ? null : el('select', {
      style: { position: 'absolute', inset: 0, width: '100%', height: '100%', opacity: 0, cursor: 'pointer', appearance: 'none', WebkitAppearance: 'none' },
      'aria-label': 'Pricing tier',
      title: 'Switch pricing tier',
      onchange: (e) => { const t = PICK.find(x => x.id === e.target.value); if (!t) return; st.tier = t.id; if (!t.onetime) st.onetime = {}; rerender(); },
    }, ...PICK.map(t => el('option', { value: t.id, selected: t.id === st.tier }, t.label)));
    // Ⓜ — D2D only: flips the sheet to minimum pricing (per Isaac).
    const mBtn = st.tier === 'd2d' ? el('button', {
      title: st.min ? 'Showing minimums — tap for display pricing' : 'Tap for minimum pricing',
      'aria-pressed': st.min ? 'true' : 'false',
      class: 'inline-flex items-center justify-center font-black transition',
      style: { width: '30px', height: '30px', borderRadius: '50%', border: '2px solid ' + (st.min ? C.orange : C.line), background: st.min ? C.orange : 'transparent', color: st.min ? '#fff' : C.char, fontSize: '13px', lineHeight: 1, flexShrink: 0 },
      onclick: (e) => { e.stopPropagation(); st.min = !st.min; rerender(); },
    }, 'M') : null;
    const tierName = (t) => t.id === 'd2d' ? 'D2D Pricing' : (t.label + ' Pricing');   // the Ⓜ button shows minimums are on; the tag stays 'D2D Pricing' (per Isaac)

    // ── sheet primitives (fixed colours — the sheet doesn't theme) ──
    const card = (...kids) => el('div', { style: { background: C.card, border: '1.5px solid ' + C.line, borderRadius: '12px', overflow: 'hidden', color: C.char } }, ...kids);
    const mono = (txt, o = {}) => el('div', { style: Object.assign({ font: '400 ' + (o.size || 9) + 'px/1.25 ' + MONO, letterSpacing: '.12em', textTransform: 'uppercase', color: o.color || C.ink2 }, o.style || {}) }, txt);
    // `extra` (the New / Existing toggle) sits at the right edge of the header (per Isaac).
    const secH = (title, sub, extra) => el('div', { class: 'flex items-center justify-between gap-3 flex-wrap', style: { padding: '12px 14px 6px' } },
      el('div', { style: { font: '400 10px/1 ' + MONO, letterSpacing: '.16em', textTransform: 'uppercase', color: C.char } }, title),
      extra || (sub ? mono(sub, { size: 8, style: { textAlign: 'right' } }) : null));
    // Service pickers (Pest / Rodent …) sit at the top-right in the sheet's small mono caps; the picked one turns
    // into an orange tag.
    const svcPick = (txt, on, onclick) => el('button', { onclick, 'aria-pressed': on ? 'true' : 'false', style: { background: on ? C.orange : 'transparent', color: on ? '#fff' : C.char, border: '1.2px solid ' + (on ? C.orange : C.ink3), font: '500 9px/1 ' + MONO, letterSpacing: '.12em', textTransform: 'uppercase', padding: '5px 8px', borderRadius: '6px', cursor: 'pointer', whiteSpace: 'nowrap' } }, txt);
    // Price tile — dark green, mono caps on top, "$99 initial", the big light number, "monthly". Orange = the
    // highlighted plan (Standard's Bi-Monthly is MOST POPULAR, per Isaac); the picked tile gets a thick ink ring
    // and a check so it reads on either colour.
    const PICKED = { border: '3px solid ' + C.char, boxShadow: '0 0 0 2px #fff inset, 0 10px 20px -12px rgba(0,0,0,.8)' };
    const tick = () => el('span', { style: { position: 'absolute', top: '-8px', right: '-8px', width: '20px', height: '20px', borderRadius: '50%', background: C.char, color: '#fff', font: '900 11px/20px ' + SANS, textAlign: 'center', boxShadow: '0 0 0 2px #fff' } }, '✓');
    const tile = (label, initV, val, on, onclick, o = {}) => {
      const hot = !!o.popular;
      const dim = hot ? 'rgba(255,255,255,.88)' : 'rgba(242,241,234,.72)';
      return el('button', { onclick, 'aria-pressed': on ? 'true' : 'false', style: Object.assign({ position: 'relative', background: hot ? C.orange : C.green, color: '#fff', borderRadius: '8px', padding: (hot ? '15px' : '10px') + ' 4px 9px', textAlign: 'center', border: '1.5px solid ' + (hot ? '#9C3209' : C.greenLine), cursor: onclick ? 'pointer' : 'default', minWidth: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '7px' }, on ? PICKED : {}) },
        hot ? el('span', { style: { position: 'absolute', top: '-9px', left: '50%', transform: 'translateX(-50%)', background: C.char, color: '#fff', font: '700 7.5px/1 ' + MONO, letterSpacing: '.14em', textTransform: 'uppercase', padding: '4px 7px', borderRadius: '999px', whiteSpace: 'nowrap' } }, 'Most popular') : null,
        on ? tick() : null,
        el('div', { style: { font: '400 9px/1 ' + MONO, letterSpacing: '.14em', textTransform: 'uppercase', color: dim } }, label),
        el('div', { style: { font: '400 9px/1 ' + MONO, color: dim } }, money(initV) + ' initial'),
        el('div', { class: 'ps-big', style: { font: '300 34px/1 ' + SANS, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: hot ? '#fff' : (isMin ? '#F2A27E' : C.light) } }, money(val)),
        el('div', { style: { font: '400 9px/1 ' + MONO, letterSpacing: '.06em', color: dim } }, 'monthly'));
    };

    // ── program blocks (Home · Yard · Termite) ──
    const program = (p) => {
      const isT = p.id === 'termite';
      const onProg = isT ? !!st.termite : (!!baseSvc && baseSvc.program === p.id);
      const toggleT = () => { st.termite = !st.termite; rerender(); };
      const head = el('div', { class: 'flex items-start justify-between gap-3', style: { padding: '14px 14px 10px' } },
        el('div', { style: { font: '700 16px/1.1 ' + SANS, textTransform: 'uppercase', letterSpacing: '-.005em', color: C.char, whiteSpace: 'nowrap' } }, p.label),
        isT
          ? svcPick(st.termite ? 'Added ✓' : 'Termite · add', !!st.termite, toggleT)
          : el('div', { class: 'flex flex-col items-end gap-1' }, ...(p.show || p.services).map(sid => svcPick(PRICING_SERVICES[sid].label, st.base === sid, () => { if (st.base === sid) { st.base = null; st.addons = {}; } else { st.base = sid; delete st.addons[sid]; } rerender(); }))));
      if (isT) {
        // The termite bar: one wide orange strip (per Isaac) — ANNUAL · $399 initial · $29 monthly — tap to add.
        const on = !!st.termite;
        const dim = 'rgba(255,255,255,.88)';
        return card(head, el('div', { style: { padding: '0 14px 14px' } },
          el('button', { onclick: toggleT, 'aria-pressed': on ? 'true' : 'false', style: Object.assign({ position: 'relative', width: '100%', display: 'flex', alignItems: 'center', gap: '10px', background: C.orange, border: '1.5px solid #9C3209', borderRadius: '8px', padding: '10px 14px', cursor: 'pointer', color: '#fff' }, on ? PICKED : {}) },
            on ? tick() : null,
            el('span', { style: { font: '400 9px/1 ' + MONO, letterSpacing: '.16em', textTransform: 'uppercase', color: dim } }, 'Annual'),
            el('span', { style: { marginLeft: 'auto', font: '400 9px/1 ' + MONO, color: dim } }, money(T.termite[0]) + ' initial'),
            el('span', { class: 'ps-big', style: { font: '300 30px/1 ' + SANS, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: '#fff', marginLeft: '8px' } }, money(T.termite[1])),
            el('span', { style: { font: '400 9px/1 ' + MONO, color: dim } }, 'monthly'))));
      }
      return card(head,
        el('div', { class: 'grid gap-2 ps-tiles', style: { gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', padding: '0 14px 14px' } },
          ...PRICING_FREQ.map(([k, lbl], i) => tile(lbl, T.init, T[p.id][i], onProg && st.freq === k, () => { if (onProg && st.freq === k) { st.base = null; st.addons = {}; } else { if (!onProg) { st.base = p.services[0]; delete st.addons[st.base]; } st.freq = k; } rerender(); }, { popular: T.id === 'standard' && k === 'b' }))));
    };

    // ── tables (add-ons / one-time / bundle & save) in the sheet's ledger style ──
    const box = (on) => el('span', { style: { display: 'inline-flex', width: '13px', height: '13px', borderRadius: '3px', border: '1.3px solid ' + (on ? C.orange : C.ink3), background: on ? C.orange : 'transparent', color: '#fff', font: '900 9px/13px ' + SANS, justifyContent: 'center', alignItems: 'center', marginRight: '8px', flexShrink: 0 } }, on ? '✓' : '');
    // cells: [label, ...values]; a value can be { v, muted } — muted values print light grey, like "$0" and the
    // Existing column on the sheet. `valueColor` (optional): savings read green on Bundle & Save (per Isaac).
    const trow = (cells, on, onclick, i, valueColor) => el('tr', { onclick, style: { cursor: onclick ? 'pointer' : 'default', background: on ? 'rgba(217,72,15,.13)' : 'transparent' } },
      ...cells.map((c, j) => {
        const boxed = c && typeof c === 'object' && !(c instanceof Node) && 'v' in c;
        const muted = boxed && c.muted, v = boxed ? c.v : c;
        return el('td', { style: { padding: '5px 6px', textAlign: j === 0 ? 'left' : 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums',
          font: j === 0 ? '400 12px/1.25 ' + SANS : (muted ? '400 11px/1.25 ' + MONO : '700 11.5px/1.25 ' + MONO),
          color: j === 0 ? C.char : (valueColor || (muted ? C.ink3 : C.char)), borderRadius: j === 0 ? '5px 0 0 5px' : (j === cells.length - 1 ? '0 5px 5px 0' : '0') } }, v);
      }));
    const thead = (cols) => el('thead', {}, el('tr', {}, ...cols.map((c, j) => el('th', { style: { padding: '2px 6px 7px', font: '400 8.5px/1 ' + MONO, letterSpacing: '.12em', textTransform: 'uppercase', color: j === 0 ? C.char : C.ink2, fontWeight: 400, textAlign: j === 0 ? 'left' : 'right', borderBottom: '1px solid rgba(43,43,41,.25)' } }, c))));
    const table = (cols, rows) => el('div', { style: { padding: '0 8px 10px' } }, el('table', { style: { width: '100%', borderCollapse: 'separate', borderSpacing: '0 1px' } }, thead(cols), el('tbody', {}, ...rows)));
    const addonsCard = card(
      el('div', { style: { height: '10px' } }),
      el('div', { style: hasPlan ? {} : { opacity: '.5' } },
        table(['Add-ons w/ base plan', 'Initial', 'Monthly'],
          // Every add-on row always renders (the base plan's own row, and any
          // add-on it already covers, just dims — no label, reps know why) so the card never changes height and nothing below it
          // shifts when a plan is picked (per Isaac).
          T.addons.map(([id, init, mo], i) => {
            const isBase = id === st.base;
            const covered = !isBase && pricingCoveredBy(st.base, id);
            const on = !isBase && !covered && !!st.addons[id];
            const row = trow([el('span', { class: 'inline-flex items-center' }, box(on), PRICING_SERVICES[id].label), { v: money(init), muted: !init }, '+' + money(mo)], on, (hasPlan && !isBase && !covered) ? () => { if (on) delete st.addons[id]; else st.addons[id] = true; rerender(); } : null, i);
            if (isBase || covered) row.style.opacity = '.4';
            return row;
          }))),
      hasPlan ? null : mono('Pick a Home or Yard plan to add these', { size: 8, style: { padding: '0 14px 12px' } }));

    // ── one-time (Standard / Loyalty) ──
    const oneTimeCard = T.onetime ? card(
      secH('One-time services', null, el('div', { class: 'inline-flex rounded-full overflow-hidden', style: { border: '1.2px solid ' + C.ink3 } },
        ...[['new', 'New'], ['current', 'Existing']].map(([v, l]) => el('button', { onclick: () => { st.customer = v; rerender(); }, style: { padding: '3px 10px', font: '500 8.5px/1.4 ' + MONO, letterSpacing: '.1em', textTransform: 'uppercase', background: st.customer === v ? C.orange : 'transparent', color: st.customer === v ? '#fff' : C.char, border: 0, cursor: 'pointer' } }, l)))),
      table(['Service', 'New', 'Existing'],
        PRICING_ONETIME.map(([id, label, nw, cur], i) => {
          const on = !!st.onetime[id];
          const otp = (v) => v > 0 ? money(v) : 'FREE';
          return trow([el('span', { class: 'inline-flex items-center' }, box(on), label), { v: otp(nw), muted: st.customer === 'current' }, { v: otp(cur), muted: st.customer !== 'current' }], on, () => { if (on) delete st.onetime[id]; else st.onetime[id] = true; rerender(); }, i);
        }))) : null;

    // ── bundle & save (informational, computed from this tier's numbers) ──
    const saveCard = card(
      secH('Bundle & save', 'Annual savings vs separate'),
      table(['Plan', '+ TFM', '+ Mole', '+ Rodent'],
        PRICING_FREQ.map(([k, lbl], i) => trow([lbl, money(pricingSavings(T, 'tfm', i)), money(pricingSavings(T, 'mole', i)), money(pricingSavings(T, 'rodent', i))], false, null, i, '#2F7D32'))));

    // ── trust chips + reviews (D2D sheets) ──
    const chip = (big, txt, sub) => el('div', { class: 'pricing-chip', style: { background: C.card, border: '1.5px solid ' + C.line, borderRadius: '12px', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: '14px', minHeight: '76px', overflow: 'hidden' } },
      el('div', { class: 'pricing-chip-big', style: { font: '700 ' + (big.length > 2 ? '24px' : '32px') + '/1 ' + SANS, color: C.orange, flexShrink: 0, letterSpacing: '-.02em' } }, big),
      el('div', { style: { minWidth: 0, flex: '1 1 0' } },   // words wrap whole — never split mid-word (per Isaac)
        el('div', { class: 'pricing-chip-txt', style: { font: '700 12px/1.2 ' + SANS, color: C.char, textTransform: 'uppercase', letterSpacing: '.01em', overflowWrap: 'normal', wordBreak: 'keep-all', hyphens: 'none' } }, txt),
        sub ? mono(sub, { size: 8, style: { marginTop: '4px', letterSpacing: '.02em', textTransform: 'none', hyphens: 'none' } }) : null));
    // Stretches to fill whatever height the add-ons column leaves (per Isaac).
    const reviews = el('div', { style: { background: C.card, border: '1.5px solid ' + C.line, borderRadius: '12px', padding: '18px 14px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '6px', justifyContent: 'center', flex: '1 1 auto', minHeight: '150px' } },
      el('span', { style: { width: '40px', height: '40px', borderRadius: '50%', background: C.green, color: C.light, font: '700 22px/40px ' + SANS, display: 'inline-block' } }, 'G'),
      el('span', { style: { color: C.orange, fontSize: '22px', letterSpacing: '.08em', lineHeight: 1 } }, '★★★★★'),
      el('b', { style: { font: '700 14px/1.2 ' + SANS, color: C.char } }, 'Over 15,000+ Google Reviews'),
      mono('5-star rated', { size: 8.5 }));

    // ── the sheet ──
    // Build a plan ⇄ Price sheet (per Isaac, Nov 23): same quote underneath, two ways to build it.
    const modeOn = (v) => (st.mode === 'sheet') === (v === 'sheet');
    const modeBar = el('div', { style: { display: 'flex', gap: '4px', padding: '14px 22px 0' } },
      ...[['build', 'Build a plan'], ['sheet', 'Price sheet']].map(([v, l]) => el('button', { onclick: () => { st.mode = v; st.cust = false; rerender(); }, 'aria-pressed': modeOn(v) ? 'true' : 'false', style: { font: '600 9px/1 ' + MONO, letterSpacing: '.12em', textTransform: 'uppercase', padding: '7px 11px', borderRadius: '999px', border: '1.2px solid ' + (modeOn(v) ? C.char : C.ink3), background: modeOn(v) ? C.char : 'transparent', color: modeOn(v) ? '#fff' : C.char, cursor: 'pointer' } }, l)));
    const header = el('div', { class: 'flex items-center justify-between gap-3 flex-wrap ps-head', style: { padding: '22px 22px 4px' } },
      el('div', { class: 'ps-title', style: { font: '800 34px/1 ' + SANS, letterSpacing: '-.015em', color: C.char, textTransform: 'uppercase' } }, st.mode === 'sheet' ? 'Price Sheet' : 'Build a Plan'),
      // Admins get every tier as its own tag (per Isaac); office/loyalty users get one tag with a dropdown;
      // sales reps get a plain D2D label.
      isAdmin
        ? el('div', { class: 'flex items-center gap-1.5 flex-wrap justify-end' },
            mBtn,
            ...PICK.map(t => el('button', {
              onclick: () => { if (st.tier === t.id) return; st.tier = t.id; if (!t.onetime) st.onetime = {}; editKey = null; rerender(); },
              'aria-pressed': st.tier === t.id ? 'true' : 'false',
              style: { background: st.tier === t.id ? C.orange : 'transparent', color: st.tier === t.id ? '#fff' : C.char, border: '1.5px solid ' + (st.tier === t.id ? '#9C3209' : C.line), font: '700 12px/1 ' + SANS, padding: '8px 14px', borderRadius: '6px', cursor: 'pointer' },
            }, st.tier === t.id ? tierName(t) : t.label)))
        : el('div', { class: 'flex items-center gap-2' },
            mBtn,
            el('span', { class: 'relative inline-flex items-center gap-2', style: { background: C.orange, color: '#fff', font: '700 13px/1 ' + SANS, padding: '9px 18px', borderRadius: '6px', border: '1.5px solid #9C3209', cursor: locked ? 'default' : 'pointer', minWidth: '170px', justifyContent: 'center' } },
              tierName(PRICING_TIERS.find(t => t.id === st.tier) || T),
              locked ? null : el('span', { style: { opacity: '.85' } }, '▾'),
              sel)));
    const headWrap = el('div', {}, modeBar, header);
    const footer = el('div', { class: 'flex items-center justify-between', style: { margin: '2px 22px 18px', paddingTop: '12px', borderTop: '1px solid rgba(43,43,41,.25)', color: C.char } },
      el('img', { src: 'ridd-logo.png', alt: 'RIDD', style: { height: '24px', width: 'auto', display: 'block' } }),
      (() => {   // RIDD's mark (the same path the header uses), in ink like the printed sheet
        if (typeof RIDD_SPIDER_PATH !== 'string') return typeof riddSpiderMark === 'function' ? riddSpiderMark(24) : el('span', {}, '');
        const NS = 'http://www.w3.org/2000/svg', sv = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
        sv.setAttribute('viewBox', '0 0 109.2 117.4'); sv.setAttribute('width', 24); sv.setAttribute('height', 26); sv.setAttribute('aria-label', 'RIDD');
        pa.setAttribute('d', RIDD_SPIDER_PATH); pa.setAttribute('fill', C.char); sv.append(pa); sv.style.display = 'block';
        return sv;
      })());
    const board = st.mode !== 'sheet' ? null : el('div', { style: { background: C.page, borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(43,43,41,.18)', boxShadow: '0 18px 40px -28px rgba(0,0,0,.45)' } },
      headWrap,
      el('div', { class: 'flex flex-col gap-3 ps-body', style: { padding: '14px 22px 18px' } },
        el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))' } }, program(PRICING_PROGRAMS[0]), program(PRICING_PROGRAMS[1])),
        program(PRICING_PROGRAMS[2]),
        el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))' } },
          addonsCard,
          el('div', { class: 'flex flex-col gap-3' }, oneTimeCard, saveCard, T.onetime ? null : reviews)),
        // Trust chips — the guarantee goes last: on phones the last chip spans the full width, so its long word
        // never has to squeeze (per Isaac).
        T.onetime ? null : el('div', { class: 'grid gap-3 pricing-chips', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))' } },
          chip('🐾', 'Kid & Pet Friendly'), chip('✓', 'Licensed & Insured'), chip('100%', 'Satisfaction Guarantee', 'Backed by unlimited free re\u2011services'))),
      footer);


    // ── BUILD A PLAN (per Isaac, Nov 23 — mockup option B): one frequency switch, three packages with one monthly
    // each (the middle one is MOST POPULAR and picked by default), extras as +$ chips, a running total and a
    // customer view. Packages are just presets over the same quote (st.base / st.addons / st.termite), so every
    // price comes from this tier's numbers and custom prices / floors behave exactly as on the sheet.
  let builder = null;
  if (st.mode !== 'sheet') {
    // Packages (per Isaac, Nov 23): Home (Pest or Rodent), Home + Yard (one Home service + one Yard service — Pest +
    // Tick, Flea & Mosquito picked, Rodent / Mole one tap away), Custom Protection (tap any services on or off) and
    // the Termite Defense contract on its own. Each card's picks live in st.pk; the card's config is a preset over
    // the quote (base + add-ons + termite), so prices, tiers, custom prices and floors are unchanged.
    if (!st.pk) st.pk = {};
    const pk = st.pk;
    if (!pk.home) pk.home = 'pest';
    if (!pk.hy) pk.hy = { home: 'pest', yard: 'tfm' };
    if (!pk.custom) pk.custom = { pest: true, tfm: true, mole: true, rodent: true, termite: true };
    const CORE = ['pest', 'rodent', 'tfm', 'mole'];
    const cfgOf = (id) => {
      if (id === 'home') return { id, label: 'Home', custName: 'Home Protection', base: pk.home, addons: [], termite: false, blurb: 'Inside + outside the home' };
      if (id === 'homeyard') return { id, label: 'Home + Yard', custName: 'Home + Yard Protection', base: pk.hy.home, addons: [pk.hy.yard], termite: false, popular: true };
      if (id === 'custom') {
        const on = CORE.filter(s => pk.custom[s]);
        return { id, label: 'Custom Protection', custName: 'Custom Protection', base: on[0] || null, addons: on.slice(1), termite: !!pk.custom.termite };
      }
      if (id === 'termite') return { id, label: 'Termite Defense', custName: 'Termite Defense', base: null, addons: [], termite: true, blurb: 'Annual termite contract · adds to any plan' };
      return null;
    };
    const PKGS = ['home', 'homeyard', 'custom', 'termite'].map(cfgOf);
    const fiB = Math.max(0, PRICING_FREQ.findIndex(([k]) => k === st.freq));
    const freqWord = { q: 'every 3 months', b: 'every 2 months', m: 'every month' }[st.freq] || '';
    if (!st.extras) st.extras = {};
    const pkgOf = (id) => cfgOf(id);
    const pkgMo = (c) => pricingQuote(Object.assign({}, st, { base: c.base, addons: Object.fromEntries(c.addons.map(a => [a, true])), termite: c.termite, onetime: {}, custom: {} }));
    // What the same coverage costs bought as separate plans (each service as its own Home / Yard plan; an add-on with
    // no plan of its own counts at its add-on price) — the struck-out anchor next to every bundle price.
    const aloneMo = (id) => { if (!id) return 0; const prog = (PRICING_SERVICES[id] || {}).program; if (prog && T[prog]) return T[prog][fiB]; const a = T.addons.find(x => x[0] === id); return a ? a[2] : 0; };
    const separateMo = (c) => aloneMo(c.base) + c.addons.reduce((a, id) => a + aloneMo(id), 0) + (c.termite ? T.termite[1] : 0);
    const applyPkg = (c) => {
      st.pkg = c.id; st.base = c.base; st.termite = c.termite || !!st.extras.termite;
      st.addons = Object.fromEntries(c.addons.map(a => [a, true]));
      for (const id of Object.keys(st.extras)) if (id !== 'termite' && id !== c.base && !c.addons.includes(id) && (!c.base || !pricingCoveredBy(c.base, id)) && T.addons.some(x => x[0] === id)) st.addons[id] = true;
      if (!st.base) st.addons = {};   // add-ons need a Home / Yard plan; Termite Defense stands alone
    };
    // The package the quote still matches (an edit on the sheet can move it off every package).
    const fits = (c) => !!c && (st.base || null) === c.base && c.addons.every(a => st.addons[a]) && (!c.termite || !!st.termite);
    const curPkg = fits(pkgOf(st.pkg)) ? pkgOf(st.pkg) : null;
    const perDay = (mo) => '$' + (mo * 12 / 365).toFixed(2) + '/day';

    const seg = el('div', { style: { display: 'flex', border: '1.5px solid ' + C.line, borderRadius: '8px', overflow: 'hidden' } },
      ...PRICING_FREQ.map(([k, lbl]) => el('button', { onclick: () => { st.freq = k; rerender(); }, 'aria-pressed': st.freq === k ? 'true' : 'false', style: { flex: '1 1 0', padding: '10px 0', font: '600 9.5px/1 ' + MONO, letterSpacing: '.1em', textTransform: 'uppercase', background: st.freq === k ? C.char : 'transparent', color: st.freq === k ? '#fff' : C.char, border: 0, cursor: 'pointer' } }, lbl)));

    // A service pill on a card: filled = in the plan, outline = available. Tapping one also picks the card.
    const svcPill = (txt, on, onTap) => el('button', { onclick: (e) => { e.stopPropagation(); onTap(); }, 'aria-pressed': on ? 'true' : 'false', style: { font: '500 8.5px/1 ' + MONO, letterSpacing: '.06em', textTransform: 'uppercase', background: on ? C.char : '#fff', color: on ? '#fff' : C.ink2, border: '1px solid ' + (on ? C.char : 'rgba(0,0,0,.18)'), borderStyle: on ? 'solid' : 'dashed', borderRadius: '999px', padding: '5px 8px', cursor: 'pointer' } }, (on ? '✓ ' : '+ ') + txt);
    const L = (id) => id === 'termite' ? 'Termite' : PRICING_SERVICES[id].label;
    const pickThen = (id, fn) => () => { fn(); applyPkg(cfgOf(id)); rerender(); };
    // Termite Defense is its own subscription (per Isaac): its card is an on/off box that rides alongside whatever
    // plan is picked (or stands alone), not a fourth package.
    const toggleTermite = () => {
      const nv = !st.termite; st.termite = nv;
      if (nv) st.extras.termite = true; else delete st.extras.termite;
      if (st.pkg === 'custom') pk.custom.termite = nv;
      rerender();
    };
    const pillsFor = (c) => {
      if (c.id === 'home') return ['pest', 'rodent'].map(s => svcPill(L(s), pk.home === s, pickThen('home', () => { pk.home = s; })));
      if (c.id === 'homeyard') return [
        ...['pest', 'rodent'].map(s => svcPill(L(s), pk.hy.home === s, pickThen('homeyard', () => { pk.hy.home = s; }))),
        el('span', { style: { font: '400 10px/22px ' + MONO, color: C.ink3, padding: '0 2px' } }, '+'),
        ...['tfm', 'mole'].map(s => svcPill(L(s), pk.hy.yard === s, pickThen('homeyard', () => { pk.hy.yard = s; })))];
      if (c.id === 'custom') return [...CORE, 'termite'].map(s => svcPill(L(s), !!pk.custom[s], pickThen('custom', () => { pk.custom[s] = !pk.custom[s]; })));
      return [svcPill('Termite', !!st.termite, toggleTermite)];
    };

    const pkgCard = (c) => {
      const empty = !c.base && !c.termite;
      const pq = empty ? { mo: 0, init: 0, savings: 0 } : pkgMo(c), sep = separateMo(c), save = pq.savings;   // same yearly savings math as the quote (Bundle & Save)
      const isT = c.id === 'termite';
      const on = isT ? !!st.termite : (st.pkg === c.id && !!curPkg);
      return el('div', { role: 'button', tabindex: '0', onclick: () => { if (isT) return toggleTermite(); if (on) { st.pkg = null; st.base = null; st.addons = {}; rerender(); return; } if (!empty) { applyPkg(c); rerender(); } }, 'aria-pressed': on ? 'true' : 'false', style: { position: 'relative', display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', background: C.card, color: C.char, borderRadius: '12px', padding: '13px 13px 11px', border: on ? '3px solid ' + C.orange : '1.5px solid ' + C.line, boxShadow: on ? '0 10px 22px -14px rgba(217,72,15,.9)' : 'none' } },
        c.popular ? el('span', { style: { position: 'absolute', top: '-9px', right: '12px', background: C.orange, color: '#fff', font: '700 7.5px/1 ' + MONO, letterSpacing: '.14em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: '999px' } }, 'Most homeowners pick this' + (on ? ' ✓' : '')) : (on ? el('span', { style: { position: 'absolute', top: '-9px', right: '12px', background: C.char, color: '#fff', font: '700 7.5px/1 ' + MONO, letterSpacing: '.14em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: '999px' } }, 'Picked ✓') : null),
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px' } },
          el('div', { style: { font: '800 16px/1 ' + SANS, textTransform: 'uppercase' } }, c.label),
          el('div', { style: { whiteSpace: 'nowrap' } },
            !empty && sep > pq.mo + 0.5 ? el('span', { style: { font: '400 11px/1 ' + MONO, color: C.ink3, textDecoration: 'line-through', marginRight: '6px' } }, money(sep)) : null,
            el('span', { style: { font: '300 30px/1 ' + SANS, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' } }, empty ? '—' : money(pq.mo)),
            el('span', { style: { font: '400 10px/1 ' + MONO, color: C.ink2 } }, '/mo'))),
        el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '5px', marginTop: '9px' } }, ...pillsFor(c)),
        el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '8px', marginTop: '9px', font: '400 9.5px/1.3 ' + MONO, color: C.ink2 } },
          el('span', {}, empty ? 'Tap the services this home needs' : money(pq.init) + ' initial · about ' + perDay(pq.mo)),
          save > 0 ? el('b', { style: { color: '#2F7D32' } }, 'Saves ' + money(save) + '/yr') : el('span', {}, c.blurb || '')));
    };

    // Extras: every add-on the picked package doesn't already include. Termite is its own box above.
    const extrasRow = () => {
      if (!curPkg || !curPkg.base) return null;
      const chipX = (id, label, mo, on, toggle) => el('button', { onclick: toggle, 'aria-pressed': on ? 'true' : 'false', style: { font: '500 9.5px/1 ' + MONO, border: '1.2px solid ' + (on ? C.char : C.ink3), borderRadius: '999px', padding: '7px 9px', background: on ? C.char : '#fff', color: on ? '#fff' : C.char, cursor: 'pointer' } }, (on ? '' : '+ ') + label + ' ' + money(mo) + (on ? ' ✓' : ''));
      // Anything not already in the plan — incl. the other core services as add-ons (Home on Pest offers Rodent and
      // vice versa, per Isaac, Nov 23).
      const ids = T.addons.filter(([id]) => id !== curPkg.base && !curPkg.addons.includes(id) && !pricingCoveredBy(curPkg.base, id) && !(curPkg.addons.includes('tfm') && id === 'seasonal'));
      return el('div', {},
        mono('Add extras', { size: 9, style: { margin: '14px 0 6px' } }),
        el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px' } },
          ...ids.map(([id, , mo]) => chipX(id, PRICING_SERVICES[id].label, mo, !!st.addons[id], () => { if (st.addons[id]) { delete st.addons[id]; delete st.extras[id]; } else { st.addons[id] = true; st.extras[id] = true; } rerender(); })),
          null));   // no Termite chip (per Isaac, Nov 23) — the Termite Defense box adds it
    };

    const extrasNames = () => curPkg ? [...Object.keys(st.addons).filter(id => !curPkg.addons.includes(id)).map(id => PRICING_SERVICES[id].label), ...(st.termite && !curPkg.termite ? ['Termite'] : [])] : [];
    const totalBar = el('div', { style: { background: C.green, color: '#fff', borderRadius: '12px', padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', marginTop: '14px', opacity: q.ok ? 1 : .55 } },
      el('div', { style: { minWidth: 0 } },
        mono(curPkg ? [curPkg.label, ...extrasNames()].join(' + ') : 'Pick a package', { size: 8.5, color: 'rgba(242,241,234,.75)', style: { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }),
        el('div', { style: { font: '300 28px/1.05 ' + SANS, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' } }, money(q.mo), el('span', { style: { font: '400 10px/1 ' + MONO } }, '/mo'))),
      el('div', { style: { textAlign: 'right', flexShrink: 0 } },
        mono('Today', { size: 8.5, color: 'rgba(242,241,234,.75)' }),
        el('div', { style: { font: '300 28px/1.05 ' + SANS, fontVariantNumeric: 'tabular-nums' } }, money(q.init))));
    const showBtn = el('button', { onclick: () => { if (!q.ok) return; st.cust = true; rerender(); window.scrollTo(0, 0); }, style: { display: 'block', width: '100%', marginTop: '10px', background: C.orange, color: '#fff', font: '700 12.5px/1 ' + SANS, textTransform: 'uppercase', letterSpacing: '.06em', borderRadius: '10px', padding: '14px', border: '1.5px solid #9C3209', cursor: q.ok ? 'pointer' : 'not-allowed', opacity: q.ok ? 1 : .55 } }, 'Show customer →');

    // Customer view: one big monthly, the struck-out separate price, daily cost, what's covered, the savings and the
    // guarantee — no tiers, no minimums, no Ⓜ. The rep can hand the phone over.
    const customerView = () => {
      const sep = (curPkg ? separateMo(curPkg) : 0) + (q.mo - (curPkg ? pkgMo(curPkg).mo : 0));
      const save = q.savings;   // same yearly savings the rep's quote shows
      const lines = [
        ...(st.base ? [[PRICING_SERVICES[st.base].label + (PRICING_SERVICES[st.base].program === 'yard' ? ', yard treatment' : ' control, inside + out'), freqWord]] : []),
        ...Object.keys(st.addons).map(id => [PRICING_SERVICES[id].label, curPkg && curPkg.addons.includes(id) ? freqWord : 'included']),
        ...(st.termite ? [['Termite Defense', 'yearly']] : []),
        ['Free re-services between visits', 'unlimited'],
      ];
      const row = ([a, b]) => el('div', { style: { display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '9px 0', borderBottom: '1px dashed rgba(0,0,0,.25)' } },
        el('span', { style: { font: '400 13px/1.2 ' + SANS } }, el('span', { style: { color: C.orange, fontWeight: 900, marginRight: '7px' } }, '✓'), a),
        el('span', { style: { font: '400 10px/1.2 ' + MONO, color: C.ink2, whiteSpace: 'nowrap' } }, b));
      return el('div', { style: { background: C.page, borderRadius: '14px', border: '1px solid rgba(43,43,41,.18)', boxShadow: '0 18px 40px -28px rgba(0,0,0,.45)', padding: '18px 20px 20px', textAlign: 'center', color: C.char } },
        el('button', { onclick: () => { st.cust = false; rerender(); }, style: { display: 'block', marginLeft: 'auto', font: '600 9px/1 ' + MONO, letterSpacing: '.12em', textTransform: 'uppercase', background: 'transparent', border: '1.2px solid ' + C.ink3, borderRadius: '999px', padding: '6px 10px', cursor: 'pointer', color: C.char } }, '← Back to the builder'),
        el('div', { style: { font: '800 26px/1.1 ' + SANS, textTransform: 'uppercase', marginTop: '10px' } }, (curPkg ? curPkg.custName + (st.termite && !curPkg.termite ? ' + Termite' : '') : (st.termite && !st.base ? 'Termite Defense' : 'Your Plan'))),
        mono(PRICING_FREQ[fiB][1] + ' service', { size: 9.5, style: { marginTop: '4px' } }),
        sep > q.mo + 0.5 ? el('div', { style: { font: '400 11px/1 ' + MONO, color: C.ink3, textDecoration: 'line-through', marginTop: '12px' } }, money(sep) + '/mo if bought separately') : null,
        el('div', { style: { font: '300 68px/1 ' + SANS, letterSpacing: '-.03em', marginTop: '8px', fontVariantNumeric: 'tabular-nums' } }, money(q.mo), el('span', { style: { font: '400 13px/1 ' + MONO, color: C.ink2, letterSpacing: 0 } }, '/mo')),
        el('div', { style: { font: '400 12px/1.5 ' + MONO, color: C.ink2, marginTop: '6px' } }, 'That’s about ' + perDay(q.mo).replace('/day', ' a day'), el('br'), money(q.init) + ' today to get started'),
        el('div', { style: { textAlign: 'left', marginTop: '16px', borderTop: '1px dashed rgba(0,0,0,.25)' } }, ...lines.map(row)),
        el('div', { style: { background: '#EAF4EA', border: '1.5px solid #2F7D32', borderRadius: '10px', padding: '11px', marginTop: '14px', font: '700 12px/1.4 ' + MONO, color: '#2F7D32' } },
          save > 0 ? 'You keep ' + money(save) + ' a year by bundling' : 'Everything in one plan, one visit schedule',
          el('div', { style: { fontWeight: 400, fontSize: '10px', marginTop: '3px' } }, '100% satisfaction guarantee · unlimited free re‑services · 15,000+ Google reviews ★★★★★')),
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '16px', paddingTop: '12px', borderTop: '1px solid rgba(43,43,41,.2)' } },
          el('img', { src: 'ridd-logo.png', alt: 'RIDD', style: { height: '18px', width: 'auto', display: 'block' } }),
          mono('Kid & pet friendly · licensed & insured', { size: 8.5 })));
    };

    builder = st.cust ? customerView() : el('div', { style: { background: C.page, borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(43,43,41,.18)', boxShadow: '0 18px 40px -28px rgba(0,0,0,.45)' } },
      headWrap,
      el('div', { class: 'ps-body', style: { padding: '14px 22px 20px' } },
        mono('How often?', { size: 9, style: { marginBottom: '6px' } }),
        seg,
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '12px', marginTop: '16px' } }, ...PKGS.map(pkgCard)),
        extrasRow(),
        // No running total here (per Isaac, Nov 23) — the receipt alongside (on top on phones) already shows it.
        el('div', { style: { height: '4px' } }),
        showBtn),
      footer);
  }

    // ── quote, laid out like a receipt in the slick's cream (per Isaac) ──
    // Every line has a pencil: tap it to type a custom initial / monthly.
    // The floor (D2D minimum, or the tier's list price if lower) is hard —
    // anything under it is refused with the floor shown, so nobody sets an
    // expectation the office can't honor (per Isaac).
    const F = MONO;   // the quote reads like an invoice: typewriter mono throughout
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
      el('span', { style: { font: '700 9px/1 ' + F, letterSpacing: '.14em', textTransform: 'uppercase', color: o.green ? '#8FD19E' : o.accent ? '#F6A47F' : 'rgba(251,244,218,.7)' } }, lbl),
      el('span', { style: { font: '700 ' + (o.big ? '24px' : '14px') + '/1.1 ' + F, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color: o.green ? '#8FD19E' : o.accent ? '#F6A47F' : C.cream } }, val));
    const tierLabel = 'Quote \u00b7 ' + (st.tier === 'd2d' ? (st.min ? 'D2D minimums' : 'D2D') : T.label);
    // EMPTY quote (per Isaac): one row that says where the quote will appear
    // — no totals block, no Reset (nothing to reset). ~44px instead of ~200.
    const quoteEmpty = el('div', { class: 'pq-card pq-empty mb-3', style: { background: C.cream, color: C.char, borderRadius: '12px', padding: '10px 14px', boxShadow: 'var(--shadow-lg)', border: '1.5px solid ' + C.orange } },
      el('div', { style: { font: '700 10px/1 ' + F, letterSpacing: '.16em', textTransform: 'uppercase', color: C.ink2 } }, tierLabel),
      el('div', { style: { font: '500 11px/1.3 ' + F, color: C.ink3, textAlign: 'right' } }, 'Nothing selected yet \u00b7 tap a plan below'));
    const quoteFull = el('div', { class: 'pq-card mb-3', style: { background: C.cream, color: C.char, borderRadius: '12px', padding: '12px 14px', boxShadow: 'var(--shadow-lg)', border: '1.5px solid ' + C.orange } },
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' } },
        el('div', { style: { font: '700 10px/1 ' + F, letterSpacing: '.16em', textTransform: 'uppercase', color: C.ink2 } }, 'Quote · ' + (st.tier === 'd2d' ? (st.min ? 'D2D minimums' : 'D2D') : T.label)),
        el('button', { style: { padding: '5px 12px', borderRadius: '999px', border: '1.5px solid ' + C.ink3, background: 'transparent', color: C.char, font: '700 9px/1.2 ' + F, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }, onclick: () => { st.base = null; st.addons = {}; st.onetime = {}; st.termite = false; st.custom = {}; editKey = null; rerender(); } }, 'Reset')),
      el('div', { class: 'grid gap-3 items-start pricing-qgrid', style: { gridTemplateColumns: 'minmax(0, 1fr) auto' } },
        el('div', { style: { minWidth: 0 } }, ...q.lines.map(rline)),
        el('div', { style: { background: C.green, color: C.cream, borderRadius: '8px', border: '1.5px solid ' + C.greenLine, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: '7px', flexShrink: 0, minWidth: '150px', opacity: q.ok ? 1 : .55 } },
          total('Initial', money(q.init), { big: true }),
          // D2D: first-year cost is tucked away — tap Monthly to flip it into
          // view, tap again to hide (per Isaac). Standard / Loyalty show it.
          // First-year cost is tucked away on every tier (per Isaac, Nov 23 — it was D2D-only): tap Monthly to flip it
          // into view, tap again to hide.
          total('Monthly', money(q.mo) + '/mo', { accent: true, title: st.showAcv ? 'Tap to hide first-year cost' : 'Tap to show first-year cost', onclick: () => { st.showAcv = !st.showAcv; rerender(); } }),
          ...(st.showAcv ? [el('div', { style: { borderTop: '1px dashed rgba(251,244,218,.35)', margin: '1px 0' } }), total('First year', money(q.acv))] : []),
          // Annual savings from bundling (per Isaac) — builds as add-ons are ticked; green like Bundle & Save.
          ...(q.savings > 0 ? [el('div', { style: { borderTop: '1px dashed rgba(251,244,218,.35)', margin: '1px 0' } }), total('You save / yr', money(q.savings), { green: true, title: 'Annual savings vs buying each add-on as its own plan' })] : []))));

    const quote = q.empty ? quoteEmpty : quoteFull;
    // Phone: the one-line bar the quote collapses to once it's scrolled past.
    const bar = el('button', { class: 'pq-bar', 'aria-label': 'Show the quote', style: { width: '100%', textAlign: 'left', background: C.char, color: C.cream, borderRadius: '12px', padding: '8px 14px', border: '1.5px solid ' + C.orange, boxShadow: 'var(--shadow-lg)', cursor: 'pointer' },
      onclick: () => { top.classList.add('pq-open'); } },
      el('span', { style: { font: '700 9px/1 ' + F, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(251,244,218,.7)' } }, 'Quote'),
      el('span', { style: { font: '700 14px/1.1 ' + F, fontVariantNumeric: 'tabular-nums', letterSpacing: '-.01em', whiteSpace: 'nowrap' } }, money(q.init) + ' today', el('span', { style: { color: C.orange } }, ' \u00b7 ' + money(q.mo) + '/mo')),
      el('span', { style: { font: '700 9px/1 ' + F, letterSpacing: '.1em', textTransform: 'uppercase', color: C.orange } }, 'View \u25be'));
    // Picker + quote ride together as one sticky block pinned right under
    // the fixed page header (measured live — it's ~60px, not 76 — so the
    // block no longer floats mid-page and overlaps the slick). The block
    // paints the page background so nothing shows through the gaps.
    // Sticky offset follows the fixed header LIVE through CSS (60px header +
    // the phone safe-area + the update banner when it's up) — a one-time
    // measurement went stale the moment a banner/toast came or went and
    // left the quote floating mid-page over the slick (per Isaac).
    // Offset = the MEASURED header (--hdr-h, set by mountApp; safe-area and
    // banner included) so the quote never tucks under it; 60px was a guess.
    const top = el('div', { class: 'pricing-quote', style: { position: 'sticky', top: 'var(--hdr-h, calc(60px + env(safe-area-inset-top, 0px) + var(--nv-banner, 0px)))', zIndex: 5, background: 'var(--bg)' } }, q.empty ? quote : bar, quote);
    if (q.empty) bar.remove();
    const page = board || builder;
    page.classList.add('pricing-board');
    quote.style.position = ''; quote.style.top = ''; quote.style.zIndex = '';
    if (_pqOpen) top.classList.add('pq-open');
    top.addEventListener('click', (e) => { if (e.target === bar || bar.contains(e.target)) { _pqOpen = true; top.classList.add('pq-open'); } });
    // The customer view hides the rep's receipt (custom prices, floors, tiers) — the phone can be handed over.
    if (builder && st.cust) root.replaceChildren(page); else root.replaceChildren(top, page);
    _pqTop = top;
  };
  // Collapse/expand the phone quote on scroll: stuck = scrolled past where
  // it sits at the top of the page. Expanding by tap holds until the user
  // scrolls back up to the top or makes another selection.
  let _pqTop = null, _pqOpen = false;
  const onScroll = () => {
    const t = _pqTop; if (!t || !t.isConnected) return;
    const stuck = window.scrollY > 40;
    t.classList.toggle('pq-stuck', stuck);
    if (!stuck && _pqOpen) { _pqOpen = false; t.classList.remove('pq-open'); }
  };
  window.addEventListener('scroll', onScroll, { passive: true });
  render();
  // Land at the top (per Isaac): a carried-over scroll position left the
  // first program's title tucked under the sticky quote on phones.
  try { requestAnimationFrame(() => window.scrollTo(0, 0)); } catch (e) { /* noop */ }
  return root;
}

registerRiddModule({
  id: 'pricing',
  label: 'Pricing',
  title: 'PRICING',
  icon: () => (typeof svg === 'function' ? svg('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>') : el('span', {}, '$')),
  canView: () => featureOn('pricing') && (isAdminRole(state.profile?.role) || userCan('view_pricing')),   // RIDD_CONFIG.FEATURES + Settings → Permissions (default: everyone)
  render: () => viewPricing(),
});
