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
  if (!st.freq) st.freq = 'b';   // Bi-Monthly opens first — the most popular frequency (per Isaac, Nov 23)
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
  for (const l of (st.tier === 'd2d' ? lines : [])) {   // D2D quotes only (per Isaac, Nov 24)
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
    // The builder IS the price sheet (per Isaac, Nov 24): the old printed-sheet layout, its Build a plan ⇄ Price sheet
    // toggle, the customer view and the Custom Protection package were removed.
    // Landing on the builder with nothing picked starts on Home + Yard, the most popular package (the default most
    // customers keep).
    if (!st.pkg && !st.base && !st.termite && !st.noPlan) { st.pkg = 'homeyard'; st.base = 'pest'; st.addons = { tfm: true }; }
    const T = pricingTierOf(st);
    const isMin = false;   // the sheet's numbers stay white on green, minimums included (per Isaac, Nov 23)
    const PICK = pricingTierChoices(state.profile).map(id => PRICING_TIERS.find(t => t.id === id));   // sheets this user may see (per Isaac, Nov 23); D2D minimums is the Ⓜ toggle
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

    // ── small-print label (IBM Plex Mono caps) ──
    const mono = (txt, o = {}) => el('div', { style: Object.assign({ font: '400 ' + (o.size || 9) + 'px/1.25 ' + MONO, letterSpacing: '.12em', textTransform: 'uppercase', color: o.color || C.ink2 }, o.style || {}) }, txt);
    const header = el('div', { class: 'flex items-center justify-between gap-3 flex-wrap ps-head', style: { padding: '22px 22px 4px' } },
      el('div', { class: 'ps-title', style: { font: '800 34px/1 ' + SANS, letterSpacing: '-.015em', color: C.char, textTransform: 'uppercase' } }, 'Price Sheet'),
      // Admins get every tier as its own tag (per Isaac); office/loyalty users get one tag with a dropdown;
      // sales reps get a plain D2D label.
      isAdmin
        ? el('div', { class: 'flex items-center gap-1.5 flex-wrap justify-end ps-tiers' },
            mBtn,
            ...PICK.map(t => el('button', { class: 'ps-tier',
              onclick: () => { if (st.tier === t.id) return; st.tier = t.id; if (!t.onetime) st.onetime = {}; editKey = null; rerender(); },
              'aria-pressed': st.tier === t.id ? 'true' : 'false',
              style: { background: st.tier === t.id ? C.orange : 'transparent', color: st.tier === t.id ? '#fff' : C.char, border: '1.5px solid ' + (st.tier === t.id ? '#9C3209' : C.line), font: '700 12px/1 ' + SANS, padding: '8px 14px', borderRadius: '6px', cursor: 'pointer' },
            }, el('span', { class: 'ps-tl-full' }, st.tier === t.id ? tierName(t) : t.label), el('span', { class: 'ps-tl-short' }, t.id === 'd2d' ? 'D2D' : t.label))))
        : el('div', { class: 'flex items-center gap-2' },
            mBtn,
            el('span', { class: 'relative inline-flex items-center gap-2', style: { background: C.orange, color: '#fff', font: '700 13px/1 ' + SANS, padding: '9px 18px', borderRadius: '6px', border: '1.5px solid #9C3209', cursor: locked ? 'default' : 'pointer', minWidth: '170px', justifyContent: 'center' } },
              tierName(PRICING_TIERS.find(t => t.id === st.tier) || T),
              locked ? null : el('span', { style: { opacity: '.85' } }, '▾'),
              sel)));
    const headWrap = el('div', { style: { paddingTop: '6px' } }, header);
    const footer = el('div', { class: 'flex items-center justify-between', style: { margin: '2px 22px 18px', paddingTop: '12px', borderTop: '1px solid rgba(43,43,41,.25)', color: C.char } },
      el('img', { src: 'ridd-logo.png', alt: 'RIDD', style: { height: '24px', width: 'auto', display: 'block' } }),
      (() => {   // RIDD's mark (the same path the header uses), in ink like the printed sheet
        if (typeof RIDD_SPIDER_PATH !== 'string') return typeof riddSpiderMark === 'function' ? riddSpiderMark(24) : el('span', {}, '');
        const NS = 'http://www.w3.org/2000/svg', sv = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
        sv.setAttribute('viewBox', '0 0 109.2 117.4'); sv.setAttribute('width', 24); sv.setAttribute('height', 26); sv.setAttribute('aria-label', 'RIDD');
        pa.setAttribute('d', RIDD_SPIDER_PATH); pa.setAttribute('fill', C.char); sv.append(pa); sv.style.display = 'block';
        return sv;
      })());


    // ── BUILD A PLAN (per Isaac, Nov 23 — mockup option B): one frequency switch, three packages with one monthly
    // each (the middle one is MOST POPULAR and picked by default), extras as +$ chips, a running total and a
    // customer view. Packages are just presets over the same quote (st.base / st.addons / st.termite), so every
    // price comes from this tier's numbers and custom prices / floors behave exactly as on the sheet.
  let builder = null;
  {
    // Packages (per Isaac, Nov 23): Home (Pest or Rodent), Home + Yard (one Home service + one Yard service — Pest +
    // Tick, Flea & Mosquito picked, Rodent / Mole one tap away), Custom Protection (tap any services on or off) and
    // the Termite Defense contract on its own. Each card's picks live in st.pk; the card's config is a preset over
    // the quote (base + add-ons + termite), so prices, tiers, custom prices and floors are unchanged.
    if (!st.pk) st.pk = {};
    const pk = st.pk;
    if (!pk.home) pk.home = 'pest';
    if (!pk.yard) pk.yard = 'tfm';
    if (!pk.hy) pk.hy = { home: 'pest', yard: 'tfm' };
    if (pk.hy.yard === 'mole') pk.hy.yard = 'tfm';   // Mole left the Home + Yard card (it's an extra now)
    const cfgOf = (id) => {
      if (id === 'home') return { id, label: 'Home', custName: 'Home Protection', base: pk.home, addons: [], termite: false };
      // Yard on its own (per Isaac, Nov 23): Tick, Flea & Mosquito or Mole as the plan.
      if (id === 'yard') return { id, label: 'Yard', custName: 'Yard Protection', base: pk.yard, addons: [], termite: false };
      if (id === 'homeyard') return { id, label: 'RIDD Package (Home + Yard)', custName: 'RIDD Package',   // branded RIDD Package (per Isaac, Nov 23)
         base: pk.hy.home, addons: [pk.hy.yard], termite: false, popular: true };
      if (id === 'termite') return { id, label: 'Termite Defense', custName: 'Termite Defense', base: null, addons: [], termite: true };
      return null;
    };
    const PKGS = ['home', 'yard', 'homeyard', 'termite'].map(cfgOf);
    const fiB = Math.max(0, PRICING_FREQ.findIndex(([k]) => k === st.freq));
    if (!st.extras) st.extras = {};
    const pkgOf = (id) => cfgOf(id);
    const pkgMo = (c) => pricingQuote(Object.assign({}, st, { base: c.base, addons: Object.fromEntries(c.addons.map(a => [a, true])), termite: c.termite, onetime: {}, custom: {} }));
    // What the same coverage costs bought as separate plans (each service as its own Home / Yard plan; an add-on with
    // no plan of its own counts at its add-on price) — the struck-out anchor next to every bundle price.
    const aloneMo = (id) => { if (!id) return 0; const prog = (PRICING_SERVICES[id] || {}).program; if (prog && T[prog]) return T[prog][fiB]; const a = T.addons.find(x => x[0] === id); return a ? a[2] : 0; };
    const separateMo = (c) => aloneMo(c.base) + c.addons.reduce((a, id) => a + aloneMo(id), 0) + (c.termite ? T.termite[1] : 0);
    const applyPkg = (c) => {
      st.noPlan = false;
      st.pkg = c.id; st.base = c.base; st.termite = c.termite || !!st.extras.termite;
      st.addons = Object.fromEntries(c.addons.map(a => [a, true]));
      for (const id of Object.keys(st.extras)) if (id !== 'termite' && id !== c.base && !c.addons.includes(id) && (!c.base || !pricingCoveredBy(c.base, id)) && T.addons.some(x => x[0] === id)) st.addons[id] = true;
      if (!st.base) st.addons = {};   // add-ons need a Home / Yard plan; Termite Defense stands alone
    };
    // The package the quote still matches (an edit on the sheet can move it off every package).
    const fits = (c) => !!c && (st.base || null) === c.base && c.addons.every(a => st.addons[a]) && (!c.termite || !!st.termite);
    const curPkg = fits(pkgOf(st.pkg)) ? pkgOf(st.pkg) : null;
    const perDay = (mo) => '$' + (mo * 12 / 365).toFixed(2) + '/day';   // shown as 'about $X/day' in the customer view

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
      rerender();
    };
    // Either/or picks (per Isaac, Nov 24 — "they are choosing THIS or THAT"): the two services sit in one joined
    // switch with OR between them; the picked half is dark with a check, the other is outlined. Picking one is a swap,
    // never an add.
    // `live` = this card is the selected plan. Only then is the pick dark with a check; on the other cards the pick
    // is just a light fill (per Isaac, Nov 24 — three dark checks read as three plans selected).
    const choice = (opts, cur, onPick, live) => el('div', { role: 'radiogroup', class: 'ps-choice', style: { display: 'flex', alignItems: 'stretch', width: '100%', maxWidth: '300px', border: '1.3px solid ' + C.ink3, borderRadius: '14px', overflow: 'hidden', background: '#fff' } },
      ...opts.flatMap(([id, label], i) => {
        // Only the selected plan shows a pick; every option on the other cards is white and tappable — tapping one
        // selects that plan with that option (per Isaac, Nov 24: the grey halves couldn't be clicked).
        const on = live && cur === id;
        const btn = el('button', { role: 'radio', 'aria-checked': on ? 'true' : 'false', onclick: (e) => { e.stopPropagation(); if (!on) onPick(id); },
          style: { flex: '1 1 0', minWidth: 0, font: '600 8.5px/1.25 ' + MONO, letterSpacing: '.06em', textTransform: 'uppercase', padding: '6px 8px', border: 0, background: on ? C.char : 'transparent', color: on ? '#fff' : C.ink2, fontWeight: on ? '700' : '600', cursor: on ? 'default' : 'pointer', textAlign: 'center' } },
          (on ? '\u2713 ' : '') + label);
        return i === 0 ? [btn] : [el('span', { 'aria-hidden': 'true', style: { font: '700 7.5px/1 ' + MONO, letterSpacing: '.1em', color: C.ink3, display: 'flex', alignItems: 'center', padding: '0 5px', borderLeft: '1px solid ' + C.cream2, borderRight: '1px solid ' + C.cream2, background: C.cream } }, 'OR'), btn];
      }));
    const pillsFor = (c) => {
      const live = st.pkg === c.id && !!curPkg;
      if (c.id === 'home') return [choice([['pest', L('pest')], ['rodent', L('rodent')]], pk.home, (s) => pickThen('home', () => { pk.home = s; })(), live)];
      if (c.id === 'yard') return [choice([['tfm', L('tfm')], ['mole', L('mole')]], pk.yard, (s) => pickThen('yard', () => { pk.yard = s; })(), live)];
      if (c.id === 'homeyard') return [
        choice([['pest', L('pest')], ['rodent', L('rodent')]], pk.hy.home, (s) => pickThen('homeyard', () => { pk.hy.home = s; })(), live),
        el('span', { style: { font: '700 11px/1 ' + MONO, color: C.ink2, padding: '0 2px', flexBasis: '100%' } }, '+'),
        choice([['tfm', L('tfm')], ['seasonal', 'Seasonal TFM']], pk.hy.yard, (s) => pickThen('homeyard', () => { pk.hy.yard = s; })(), live)];

      return [svcPill('Termite', !!st.termite, toggleTermite)];
    };

    const pkgCard = (c) => {
      const empty = !c.base && !c.termite;
      const pq = empty ? { mo: 0, init: 0, savings: 0 } : pkgMo(c), sep = separateMo(c), save = pq.savings;   // same yearly savings math as the quote (Bundle & Save)
      const isT = c.id === 'termite';
      const on = isT ? !!st.termite : (st.pkg === c.id && !!curPkg);
      return el('div', { role: 'button', tabindex: '0', onclick: () => { if (isT) return toggleTermite(); if (on) { st.pkg = null; st.base = null; st.addons = {}; st.noPlan = true; rerender(); return; } if (!empty) { applyPkg(c); rerender(); } }, 'aria-pressed': on ? 'true' : 'false', style: { position: 'relative', display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', background: C.card, color: C.char, borderRadius: '10px', padding: '10px 12px', border: on ? '3px solid ' + C.orange : '1.5px solid ' + C.line, boxShadow: on ? '0 10px 22px -14px rgba(217,72,15,.9)' : 'none' } },
        c.popular ? el('span', { style: { position: 'absolute', top: '-9px', right: '12px', background: C.orange, color: '#fff', font: '700 7.5px/1 ' + MONO, letterSpacing: '.14em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: '999px' } }, 'Most popular' + (on ? ' ✓' : '')) : (on ? el('span', { style: { position: 'absolute', top: '-9px', right: '12px', background: C.char, color: '#fff', font: '700 7.5px/1 ' + MONO, letterSpacing: '.14em', textTransform: 'uppercase', padding: '4px 8px', borderRadius: '999px' } }, 'Picked ✓') : null),
        // Compact card (per Isaac, Nov 23): name + service pills on the left; price, then initial · per day, then
        // savings stacked on the right.
        el('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' } },
          el('div', { style: { minWidth: 0, flex: '1 1 auto' } },
            el('div', { style: { font: '800 14px/1 ' + SANS, textTransform: 'uppercase' } }, c.label),
            el('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '4px', marginTop: '8px' } }, ...pillsFor(c))),
          el('div', { style: { textAlign: 'right', flexShrink: 0 } },
            el('div', { style: { whiteSpace: 'nowrap' } },
              !empty && sep > pq.mo + 0.5 ? el('span', { style: { font: '400 10px/1 ' + MONO, color: C.ink3, textDecoration: 'line-through', marginRight: '5px' } }, money(sep)) : null,
              el('span', { style: { font: '300 25px/1 ' + SANS, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums' } }, empty ? '—' : money(pq.mo)),
              el('span', { style: { font: '400 9.5px/1 ' + MONO, color: C.ink2 } }, '/mo')),
            el('div', { style: { font: '400 9px/1.35 ' + MONO, color: C.ink2, marginTop: '4px', whiteSpace: 'nowrap' } }, empty ? 'Tap the services' : money(pq.init) + ' initial · ' + perDay(pq.mo)),
            save > 0 ? el('div', { style: { font: '700 9px/1.35 ' + MONO, color: '#2F7D32', whiteSpace: 'nowrap' } }, 'Saves ' + money(save) + '/yr') : null)));
    };

    // Extras (per Isaac, Nov 23): a fixed grid — every service always in the same spot with a small icon, so swapping
    // Pest ⇄ Rodent never reshuffles it. A service already in the plan reads "In plan", one the plan covers reads
    // "Covered", a picked extra turns dark with a check. Termite is its own box above.
    const EXTRA_ORDER = ['pest', 'rodent', 'tfm', 'seasonal', 'mole', 'snake', 'cbee', 'roach', 'flea'];
    const EXTRA_ICON = {
      pest:     'M12 6.5a2.2 2.2 0 1 0 0 .01M8.5 13.5a3.5 4.5 0 1 0 7 0a3.5 4.5 0 1 0 -7 0M8.6 11.5 4.5 9.5M15.4 11.5l4.1-2M8.6 15.5l-4.1 2M15.4 15.5l4.1 2M10.8 4.6 9.6 2.5M13.2 4.6l1.2-2.1',
      rodent:   'M3.5 16.5c0-4.4 3.6-7.5 8-7.5 4.6 0 8 3 8 7.5zM16.5 9.6a2.3 2.3 0 1 1 3.4 2.6M19.5 16.5c1.8.2 2.3 2.6.5 3.5M7.5 13.2h.01',
      tfm:      'M12 3.5c3 4 5.2 7 5.2 10a5.2 5.2 0 0 1-10.4 0c0-3 2.2-6 5.2-10z',
      seasonal: 'M12 8.2a3.8 3.8 0 1 0 .01 0M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6',
      mole:     'M2.5 19.5h19M5 19.5c1.2-5.2 4-8 7-8s5.8 2.8 7 8M10.2 9.2 12 6.5l1.8 2.7',
      snake:    'M4 17.5c3.5 0 3.5-3.5 7-3.5s3.5 3.5 7 3.5M17 7.5c-1.6-1.6-4.5-1.6-6 0s-1.4 4 .6 4.6',
      cbee:     'M8.5 9.5h7v8.5a3.5 3.5 0 0 1-7 0zM8.5 12.5h7M8.5 15.3h7M9.5 9.5c-3.4-3.6-7-1.4-5.6 1.2M14.5 9.5c3.4-3.6 7-1.4 5.6 1.2M12 9.5V7',
      roach:    'M12 6.5c3 0 5 3.2 5 7s-2 7-5 7-5-3.2-5-7 2-7 5-7zM12 6.5v14M10.4 5 7.5 2M13.6 5l2.9-3M7 12.5H3.5M17 12.5h3.5M7.4 16.5l-3 2M16.6 16.5l3 2',
      flea:     'M8.5 13.5a5 4 0 1 0 10 0a5 4 0 1 0-10 0M9.2 11.6 4 7.5M11 17.2 8 21M15.5 17.4l1.2 3.6M18 11.2a1 1 0 0 1 2 0',
    };
    const extraIcon = (id, color) => {
      const NS = 'http://www.w3.org/2000/svg', sv = document.createElementNS(NS, 'svg'), pa = document.createElementNS(NS, 'path');
      sv.setAttribute('viewBox', '0 0 24 24'); sv.setAttribute('width', 18); sv.setAttribute('height', 18); sv.setAttribute('aria-hidden', 'true');
      pa.setAttribute('d', EXTRA_ICON[id] || ''); pa.setAttribute('fill', 'none'); pa.setAttribute('stroke', color); pa.setAttribute('stroke-width', '1.6'); pa.setAttribute('stroke-linecap', 'round'); pa.setAttribute('stroke-linejoin', 'round');
      sv.append(pa); sv.style.cssText = 'display:block;flex-shrink:0';
      return sv;
    };
    const extrasRow = () => {
      if (!curPkg || !curPkg.base) return null;
      const inPlan = (id) => id === curPkg.base || curPkg.addons.includes(id);
      const covered = (id) => pricingCoveredBy(curPkg.base, id) || (inPlan('tfm') && id === 'seasonal') || (inPlan('seasonal') && id === 'tfm');
      const tile = (id) => {
        const a = T.addons.find(x => x[0] === id); if (!a) return null;
        const plan = inPlan(id), cov = !plan && covered(id), on = !plan && !cov && !!st.addons[id], off = plan || cov;
        const toggle = () => { if (st.addons[id]) { delete st.addons[id]; delete st.extras[id]; } else { st.addons[id] = true; st.extras[id] = true; } rerender(); };
        return el('button', { onclick: off ? null : toggle, disabled: off ? true : null, 'aria-pressed': on ? 'true' : 'false', title: off ? (plan ? 'Already in this plan' : 'Covered by this plan') : ((on ? 'Tap to remove' : 'Tap to add') + (a[1] ? ' · ' + money(a[1]) + ' initial' : '')),
          style: { display: 'flex', alignItems: 'center', gap: '9px', textAlign: 'left', minWidth: 0, padding: '9px 10px', borderRadius: '10px', cursor: off ? 'default' : 'pointer', opacity: off ? .45 : 1,
            background: on ? C.char : '#fff', color: on ? '#fff' : C.char, border: '1.2px ' + (off ? 'dashed ' : 'solid ') + (on ? C.char : 'rgba(43,43,41,.22)') } },
          el('span', { style: { width: '30px', height: '30px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: on ? 'rgba(255,255,255,.12)' : C.card } }, extraIcon(id, on ? '#fff' : C.green)),
          el('span', { style: { minWidth: 0, flex: '1 1 auto' } },
            el('span', { style: { display: 'block', font: '600 11px/1.2 ' + SANS, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, id === 'seasonal' ? 'Seasonal TFM' : id === 'tfm' ? 'Tick, Flea & Mosquito' : PRICING_SERVICES[id].label),
            el('span', { style: { display: 'block', marginTop: '3px', font: '400 9.5px/1 ' + MONO, color: on ? 'rgba(255,255,255,.75)' : C.ink2 } }, plan ? 'In plan' : cov ? 'Covered' : '+' + money(a[2]) + '/mo')),   // any add-on initial shows on the receipt
          on ? el('span', { style: { font: '900 12px/1 ' + SANS, flexShrink: 0 } }, '✓') : null);
      };
      return el('div', {},
        mono('Add extras', { size: 9, style: { margin: '16px 0 7px' } }),
        el('div', { class: 'ps-extras', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: '7px' } }, ...EXTRA_ORDER.map(tile)));
    };

    // One-time services (per Isaac, Nov 24): Standard and Loyalty only — D2D / Ⓜ is the customer-facing door view and
    // never shows them. New vs Existing customer price; a one-time can be quoted on its own (tap the picked plan off)
    // or alongside a plan. Same PRICING_ONETIME numbers the old price sheet used.
    const OT_ICON = { ot_termite: 'M10.5 4a6.5 6.5 0 1 0 0 13a6.5 6.5 0 1 0 0-13M15.3 15.3 20 20', ot_tfm: EXTRA_ICON.tfm, ot_pest: EXTRA_ICON.pest, ot_rodent: EXTRA_ICON.rodent, ot_roach: EXTRA_ICON.roach, ot_flea: EXTRA_ICON.flea,
      ot_sedan: 'M3 15.5v-3l2-4.5h14l2 4.5v3M3 15.5h18M6.5 15.5v2M17.5 15.5v2M5 12.5h14', ot_suv: 'M3 16v-4l1.5-5h15L21 12v4M3 16h18M6.5 16v2M17.5 16v2M4.5 12h15M12 7v5' };
    const oneTimeRow = () => {
      if (!T.onetime) return null;
      const cur = st.customer === 'current';
      const otIcon = (id, color) => { const sv = extraIcon('pest', color); sv.firstChild.setAttribute('d', OT_ICON[id] || ''); return sv; };
      const tile = ([id, label, nw, ex]) => {
        const on = !!st.onetime[id], price = cur ? ex : nw;
        return el('button', { onclick: () => { if (on) delete st.onetime[id]; else st.onetime[id] = true; rerender(); }, 'aria-pressed': on ? 'true' : 'false', title: 'New customer ' + (nw ? money(nw) : 'FREE') + ' \u00b7 existing customer ' + (ex ? money(ex) : 'FREE'),
          style: { display: 'flex', alignItems: 'center', gap: '9px', textAlign: 'left', minWidth: 0, padding: '9px 10px', borderRadius: '10px', cursor: 'pointer', background: on ? C.char : '#fff', color: on ? '#fff' : C.char, border: '1.2px solid ' + (on ? C.char : 'rgba(43,43,41,.22)') } },
          el('span', { style: { width: '30px', height: '30px', borderRadius: '8px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, background: on ? 'rgba(255,255,255,.12)' : C.card } }, otIcon(id, on ? '#fff' : C.green)),
          el('span', { style: { minWidth: 0, flex: '1 1 auto' } },
            el('span', { style: { display: 'block', font: '600 11px/1.2 ' + SANS, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' } }, label.replace('Tick, Flea, & Mosquito', 'Tick, Flea & Mosquito')),
            el('span', { style: { display: 'block', marginTop: '3px', font: '400 9.5px/1 ' + MONO, color: on ? 'rgba(255,255,255,.75)' : C.ink2 } }, price ? money(price) + ' one-time' : 'FREE')),
          on ? el('span', { style: { font: '900 12px/1 ' + SANS, flexShrink: 0 } }, '\u2713') : null);
      };
      const tog = el('div', { style: { display: 'inline-flex', border: '1.2px solid ' + C.ink3, borderRadius: '999px', overflow: 'hidden' } },
        ...[['new', 'New customer'], ['current', 'Existing']].map(([v, l]) => el('button', { onclick: () => { st.customer = v; rerender(); }, 'aria-pressed': st.customer === v ? 'true' : 'false', style: { padding: '4px 10px', font: '600 8.5px/1.3 ' + MONO, letterSpacing: '.08em', textTransform: 'uppercase', border: 0, background: st.customer === v ? C.char : 'transparent', color: st.customer === v ? '#fff' : C.ink2, cursor: 'pointer' } }, l)));
      return el('div', {},
        el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap', margin: '16px 0 7px' } }, mono('One-time services', { size: 9 }), tog),
        el('div', { class: 'ps-extras', style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(165px, 1fr))', gap: '7px' } }, ...PRICING_ONETIME.map(tile)));
    };

    builder = el('div', { style: { background: C.page, borderRadius: '14px', overflow: 'hidden', border: '1px solid rgba(43,43,41,.18)', boxShadow: '0 18px 40px -28px rgba(0,0,0,.45)' } },
      headWrap,
      el('div', { class: 'ps-body', style: { padding: '14px 22px 20px' } },
        mono('How often?', { size: 9, style: { marginBottom: '6px' } }),
        seg,
        el('div', { style: { display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '14px' } }, ...PKGS.map(pkgCard)),
        extrasRow(),
        oneTimeRow(),
        // No running total and no Show customer button (per Isaac, Nov 23) — the receipt alongside covers it.
        el('div', { style: { height: '4px' } })),
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
      // Custom prices are a D2D thing (per Isaac, Nov 24): D2D Pricing and Ⓜ minimums, any line, never under the floor
      // (the D2D minimum). Standard / Loyalty quotes are list price.
      const editable = !!l.key && st.tier === 'd2d';
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
      el('div', { style: { display: 'flex', alignItems: 'center', gap: '8px' } }, el('span', { style: { font: '500 11px/1.3 ' + F, color: C.ink3, textAlign: 'right' } }, 'Nothing selected yet'), st.tier !== 'd2d' ? null : el('button', { onclick: () => openSavedList(), style: { padding: '5px 10px', borderRadius: '999px', border: '1.5px solid ' + C.ink3, background: 'transparent', color: C.char, font: '700 9px/1.2 ' + F, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' } }, 'Saved')));
    // ── Saved quotes (per Isaac, Nov 24): Save quote → type the customer's name → it's on the rep's account
    // (public.pricing_quotes, db/migrations/20261124_pricing_quotes.sql). Saved opens the list; Open puts the picks back
    // exactly (tier the user may still see, plan, extras, one-time, custom prices). Admins see every rep's.
    const SNAP = ['tier', 'min', 'freq', 'base', 'addons', 'termite', 'onetime', 'customer', 'custom', 'pkg', 'pk', 'extras', 'noPlan'];
    const QS = (state._pricingQuotes = state._pricingQuotes || { rows: null, loading: false, error: null });
    const loadQuotes = (force) => {
      if (QS.loading || (QS.rows && !force) || typeof supabase === 'undefined' || !supabase) return;
      QS.loading = true;
      Promise.resolve(supabase.from('pricing_quotes').select('id, rep_id, customer_name, tier, initial, monthly, snapshot, created_at').order('created_at', { ascending: false }).limit(300))
        .then(({ data, error }) => { QS.loading = false; QS.error = error ? error.message : null; QS.rows = error ? [] : (data || []); if (root.isConnected) rerender(); })
        .catch((e) => { QS.loading = false; QS.error = String((e && e.message) || e); QS.rows = []; });
    };
    // D2D only (per Isaac, Nov 24): saved quotes are for sales reps on D2D Pricing / Ⓜ minimums — not Standard / Loyalty.
    const canSaveQuotes = st.tier === 'd2d';
    if (canSaveQuotes) loadQuotes();
    const sBtn = (t, fn, primary) => el('button', { onclick: fn, style: { padding: '6px 12px', borderRadius: '999px', font: '700 9px/1.2 ' + F, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer', border: '1.5px solid ' + (primary ? C.orange : C.ink3), background: primary ? C.orange : 'transparent', color: primary ? '#fff' : C.char, whiteSpace: 'nowrap' } }, t);
    const saveQuote = async (name) => {
      const nm = String(name || '').trim().slice(0, 120); if (!nm) return;
      const snapshot = JSON.parse(JSON.stringify(Object.fromEntries(SNAP.map(k => [k, st[k]]))));
      const { error } = await supabase.from('pricing_quotes').insert({ rep_id: state.profile.id, customer_name: nm, tier: st.tier === 'd2d' && st.min ? 'd2d_min' : st.tier, initial: q.init, monthly: q.mo, snapshot });
      if (error) { if (typeof toast === 'function') toast('Couldn\u2019t save the quote: ' + error.message, 'error'); return; }
      st.qSaving = false; if (typeof toast === 'function') toast('Quote saved for ' + nm, 'success');
      loadQuotes(true); rerender();
    };
    const openQuote = (row) => {
      const sn = row.snapshot || {};
      for (const k of SNAP) { if (sn[k] === undefined) delete st[k]; else st[k] = JSON.parse(JSON.stringify(sn[k])); }
      if (!pricingTierChoices(state.profile).includes(st.tier)) { st.tier = pricingDefaultTier(state.profile); st.min = false; st.custom = {}; }
      editKey = null; st.qItems = true; rerender();
    };
    const openSavedList = () => {
      const overlay = el('div', { class: 'modal-overlay' });
      const close = () => { overlay.remove(); document.removeEventListener('keydown', onKey); };
      const onKey = (e) => { if (e.key === 'Escape') close(); };
      document.addEventListener('keydown', onKey); overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
      const TL = { d2d: 'D2D', d2d_min: 'D2D min', standard: 'Standard', loyalty: 'Loyalty' };
      const who = (id) => { const p = (state.allProfiles || []).find(x => x.id === id); return p ? p.full_name : ''; };
      const body = el('div', {});
      let find = '';
      const paint = () => {
        const rows = (QS.rows || []).filter(r => !find || String(r.customer_name).toLowerCase().includes(find));
        body.replaceChildren(...(rows.length ? rows.map(r => el('div', { class: 'flex items-center gap-3 px-4 py-2.5 border-t', style: { borderColor: 'var(--border)' } },
          el('div', { class: 'flex-1 min-w-0' },
            el('div', { class: 'font-semibold text-sm truncate' }, r.customer_name),
            el('div', { class: 'text-[11px] tabular-nums', style: { color: 'var(--text-muted)' } }, [new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }), TL[r.tier] || r.tier, money(Number(r.initial) || 0) + ' initial \u00b7 ' + money(Number(r.monthly) || 0) + '/mo', r.rep_id !== state.profile.id ? who(r.rep_id) : ''].filter(Boolean).join(' \u00b7 '))),
          el('button', { class: 'rounded-lg px-3 py-1 text-[11px] font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => { close(); openQuote(r); } }, 'Open'),
          el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-bold', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, title: 'Remove this saved quote', onclick: async (e) => {
            const b = e.currentTarget; if (b.dataset.sure !== '1') { b.dataset.sure = '1'; b.textContent = 'Sure?'; return; }
            const { error } = await supabase.from('pricing_quotes').delete().eq('id', r.id);
            if (error) { if (typeof toast === 'function') toast('Couldn\u2019t remove it: ' + error.message, 'error'); return; }
            QS.rows = (QS.rows || []).filter(x => x.id !== r.id); paint(); rerender(); } }, 'Remove')))
          : [el('div', { class: 'px-4 py-8 text-center text-sm', style: { color: 'var(--text-muted)' } }, QS.error ? 'Saved quotes aren\u2019t available yet (' + QS.error + ')' : find ? 'No saved quote matches.' : 'No saved quotes yet.')]));
      };
      paint();
      overlay.append(el('div', { class: 'card', style: { width: 'min(560px, 96vw)', maxHeight: '80vh', display: 'flex', flexDirection: 'column', margin: '8vh auto 0' }, onclick: (e) => e.stopPropagation() },
        el('div', { class: 'flex items-center gap-3 px-4 py-3' },
          el('h3', { class: 'text-base font-bold flex-1' }, 'Saved quotes'),
          el('input', { type: 'search', placeholder: 'Search name', class: 'rounded-lg border px-2.5 py-1 text-[12px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '150px' }, oninput: (e) => { find = String(e.target.value || '').trim().toLowerCase(); paint(); } }),
          el('button', { class: 'text-2xl leading-none px-1', style: { color: 'var(--text-muted)' }, 'aria-label': 'Close', onclick: close }, '\u00d7')),
        el('div', { style: { overflow: 'auto' } }, body)));
      document.body.append(overlay);
    };
    const saveRow = () => {
      if (!canSaveQuotes) return null;
      const n = (QS.rows || []).length;
      if (st.qSaving) {
        const inp = el('input', { type: 'text', placeholder: 'Customer name', maxlength: 120, style: { flex: '1 1 120px', minWidth: 0, padding: '6px 10px', borderRadius: '8px', border: '1.5px solid ' + C.ink3, background: '#fff', color: C.char, font: '600 12px/1.2 ' + F } });
        inp.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); saveQuote(inp.value); } else if (e.key === 'Escape') { st.qSaving = false; rerender(); } };
        setTimeout(() => inp.focus(), 0);
        return el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', marginTop: '10px', flexWrap: 'wrap' } }, inp, sBtn('Save', () => saveQuote(inp.value), true), sBtn('Cancel', () => { st.qSaving = false; rerender(); }));
      }
      return el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'space-between', marginTop: '10px' } },
        q.ok ? sBtn('Save quote', () => { st.qSaving = true; rerender(); }, true) : el('span', {}),
        sBtn('Saved' + (n ? ' (' + n + ')' : ''), openSavedList));
    };
    // Receipt (per Isaac, Nov 24 — mobile recording): totals FIRST — initial · monthly · savings / yr — and the items in
    // the package BELOW them, folded away until the totals are tapped. Same on desktop. The card no longer swaps to a
    // one-line bar on scroll: that swap changed the sticky block's height mid-scroll and made the page jump.
    const itemsOpen = !!st.qItems || editKey != null;
    const tCell = (lbl, val, color, o = {}) => el('div', { style: { minWidth: 0, display: 'flex', flexDirection: 'column', gap: '3px', alignItems: o.right ? 'flex-end' : 'flex-start' } },
      el('span', { style: { font: '700 8.5px/1 ' + F, letterSpacing: '.14em', textTransform: 'uppercase', color: 'rgba(251,244,218,.7)', whiteSpace: 'nowrap' } }, lbl),
      el('span', { class: 'pq-num', style: { font: '700 20px/1.05 ' + F, letterSpacing: '-.02em', fontVariantNumeric: 'tabular-nums', color, whiteSpace: 'nowrap' } }, val));
    const strip = el('button', { class: 'pq-strip', 'aria-expanded': itemsOpen ? 'true' : 'false', title: itemsOpen ? 'Hide the items' : 'Show the items in this quote',
        onclick: () => { st.qItems = !itemsOpen; if (!st.qItems) editKey = null; rerender(); },
        style: { width: '100%', display: 'grid', gridTemplateColumns: q.savings > 0 ? '1fr 1fr 1fr' : '1fr 1fr', gap: '10px', alignItems: 'end', textAlign: 'left', background: C.green, color: C.cream, borderRadius: '8px', border: '1.5px solid ' + C.greenLine, padding: '10px 12px', cursor: 'pointer', opacity: q.ok ? 1 : .55 } },
      tCell('Initial', money(q.init), C.cream),
      tCell('Monthly', money(q.mo) + '/mo', '#F6A47F'),
      q.savings > 0 ? tCell('Save / yr', money(q.savings), '#8FD19E', { right: true }) : null);
    const itemsToggle = el('button', { onclick: () => { st.qItems = !itemsOpen; if (!st.qItems) editKey = null; rerender(); },
        style: { width: '100%', display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '8px', background: 'transparent', border: 0, padding: '2px 0', cursor: 'pointer', font: '700 9px/1 ' + F, letterSpacing: '.12em', textTransform: 'uppercase', color: C.ink2 } },
      el('span', {}, q.lines.length + ' item' + (q.lines.length === 1 ? '' : 's') + ' in this quote'),
      el('span', { style: { color: C.orange } }, itemsOpen ? 'Hide \u25b4' : 'Show \u25be'));
    const items = itemsOpen ? el('div', { class: 'pq-items', style: { marginTop: '4px' } },
      ...q.lines.map(rline),
      // First-year cost lives with the items now (it was a tap on Monthly).
      el('div', { style: { display: 'flex', justifyContent: 'space-between', padding: '8px 0 2px', font: '700 11px/1.2 ' + F, color: C.ink2, textTransform: 'uppercase', letterSpacing: '.06em' } }, el('span', {}, 'First year'), el('span', { style: { color: C.char, fontVariantNumeric: 'tabular-nums' } }, money(q.acv)))) : null;
    const quoteFull = el('div', { class: 'pq-card mb-3', style: { background: C.cream, color: C.char, borderRadius: '12px', padding: '10px 12px', boxShadow: 'var(--shadow-lg)', border: '1.5px solid ' + C.orange } },
      el('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', marginBottom: '6px' } },
        el('div', { style: { font: '700 10px/1 ' + F, letterSpacing: '.16em', textTransform: 'uppercase', color: C.ink2 } }, 'Quote · ' + (st.tier === 'd2d' ? (st.min ? 'D2D minimums' : 'D2D') : T.label)),
        el('button', { style: { padding: '5px 12px', borderRadius: '999px', border: '1.5px solid ' + C.ink3, background: 'transparent', color: C.char, font: '700 9px/1.2 ' + F, letterSpacing: '.1em', textTransform: 'uppercase', cursor: 'pointer' }, onclick: () => {
          // Reset = the default start (per Isaac, Nov 24): RIDD Package with Pest + Tick, Flea & Mosquito, Bi-Monthly, nothing extra. The tier (and Ⓜ) stays where it is.
          st.pkg = 'homeyard'; st.pk = { home: 'pest', yard: 'tfm', hy: { home: 'pest', yard: 'tfm' } }; st.base = 'pest'; st.addons = { tfm: true }; st.extras = {}; st.onetime = {}; st.termite = false; st.custom = {};
          st.noPlan = false; st.freq = 'b'; st.customer = 'new'; st.qItems = false; st.qSaving = false; editKey = null; rerender(); } }, 'Reset')),
      strip, itemsToggle, items, saveRow());

    const quote = q.empty ? quoteEmpty : quoteFull;
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
    const top = el('div', { class: 'pricing-quote', style: { position: 'sticky', top: 'var(--hdr-h, calc(60px + env(safe-area-inset-top, 0px) + var(--nv-banner, 0px)))', zIndex: 5, background: 'var(--bg)' } }, quote);
    const page = builder;
    page.classList.add('pricing-board');
    quote.style.position = ''; quote.style.top = ''; quote.style.zIndex = '';
    // The customer view hides the rep's receipt (custom prices, floors, tiers) — the phone can be handed over.
    root.replaceChildren(top, page);
    _pqTop = top;
  };
  let _pqTop = null;
  const onScroll = () => {};   // the quote no longer collapses on scroll (per Isaac, Nov 24 — it made the page jump)
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
