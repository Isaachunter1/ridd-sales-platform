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
  { id: 'd2d',      label: 'D2D Display',  badge: null,       init: 399, home: [79, 99, 149],  yard: [99, 119, 169],  termite: [999, 49],
    addons: [['tfm', 100, 50], ['mole', 100, 50], ['seasonal', 100, 45], ['pest', 100, 30], ['rodent', 100, 30], ['snake', 100, 30], ['cbee', 100, 30], ['roach', 200, 30], ['flea', 200, 30]], onetime: false },
  { id: 'd2d_min',  label: 'D2D Minimums', badge: 'Minimums', init: 99,  home: [49, 69, 119],  yard: [69, 89, 139],   termite: [399, 29],
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

function pricingStore() {
  state.modules = state.modules || {};
  const st = (state.modules.pricing = state.modules.pricing || {});
  if (!st.tier) st.tier = pricingDefaultTier(state.profile);
  if (!st.base) st.base = 'pest';
  if (!st.freq) st.freq = 'q';
  if (!st.addons) st.addons = {};
  if (!st.onetime) st.onetime = {};
  if (!st.customer) st.customer = 'new';
  return st;
}

function pricingQuote(st) {
  const T = PRICING_TIERS.find(t => t.id === st.tier) || PRICING_TIERS[0];
  const svc = PRICING_SERVICES[st.base] || PRICING_SERVICES.pest;
  const fi = svc.program === 'termite' ? null : Math.max(0, PRICING_FREQ.findIndex(([k]) => k === st.freq));
  const baseInit = svc.program === 'termite' ? T.termite[0] : T.init;
  const baseMo = svc.program === 'termite' ? T.termite[1] : T[svc.program][fi];
  const lines = [{ kind: 'base', label: (PRICING_PROGRAMS.find(p => p.id === svc.program) || {}).label + ' · ' + svc.label + (svc.program === 'termite' ? ' · Annual' : ' · ' + PRICING_FREQ[fi][1]), init: baseInit, mo: baseMo }];
  for (const [id, init, mo] of T.addons) {
    if (id === st.base || !st.addons[id]) continue;
    lines.push({ kind: 'addon', label: PRICING_SERVICES[id].label + ' add-on', init, mo });
  }
  if (T.onetime) for (const [id, label, nw, cur] of PRICING_ONETIME) {
    if (!st.onetime[id]) continue;
    lines.push({ kind: 'onetime', label: label + ' (one-time)', init: st.customer === 'current' ? cur : nw, mo: 0 });
  }
  const init = lines.reduce((a, l) => a + l.init, 0), mo = lines.reduce((a, l) => a + l.mo, 0);
  return { tier: T, lines, init, mo, acv: init + mo * 11 };
}

function viewPricing() {
  const st = pricingStore();
  const T = PRICING_TIERS.find(t => t.id === st.tier) || PRICING_TIERS[0];
  const isMin = T.id !== 'd2d';
  const money = (v) => '$' + Math.round(v).toLocaleString();
  const wrap = el('div', { class: 'flex flex-col gap-4 w-full' });

  // ── Tier strip (same look as the queue strip) ──
  wrap.append(el('div', { class: 'flex items-center gap-2 flex-wrap' },
    el('div', { class: 'queue-strip flex w-full rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
      ...PRICING_TIERS.map((t, i) => el('button', {
        class: 'px-2.5 py-1.5 text-[11px] font-bold transition flex-1 whitespace-nowrap' + (i ? ' border-l' : ''),
        style: st.tier === t.id ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--border-2)' } : { color: 'var(--text-muted)', borderColor: 'var(--border-2)' },
        onclick: () => { st.tier = t.id; if (!t.onetime) st.onetime = {}; mountApp(); },
      }, t.label)))));

  const secTitle = (t, sub) => el('div', { class: 'flex items-baseline justify-between gap-3 mb-2' },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, t),
    sub ? el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, sub) : null);
  const priceColor = isMin ? { color: 'var(--accent)' } : {};

  // ── 1. Base plan: program → service → frequency ──
  const baseSvc = PRICING_SERVICES[st.base];
  const baseCard = el('div', { class: 'card p-5' },
    secTitle('1 · Base plan', 'Pick the program the customer starts on'),
    el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))' } },
      ...PRICING_PROGRAMS.map(p => {
        const on = baseSvc.program === p.id;
        const prices = p.id === 'termite' ? null : T[p.id];
        return el('div', { class: 'rounded-xl border p-4 transition', style: { borderColor: on ? 'var(--accent)' : 'var(--border)', background: on ? 'rgba(223,100,58,.06)' : 'var(--card-2)' } },
          el('div', { class: 'flex items-center justify-between gap-2 mb-2' },
            el('div', { class: 'text-sm font-bold' }, p.label),
            el('div', { class: 'text-[10px] tabular-nums', style: { color: 'var(--text-muted)' } }, 'initial ' + money(p.id === 'termite' ? T.termite[0] : T.init))),
          el('div', { class: 'flex gap-1.5 flex-wrap mb-3' },
            ...p.services.map(sid => el('button', {
              class: 'px-2.5 py-1 rounded-full text-[11px] font-bold border transition',
              style: st.base === sid ? { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' } : { borderColor: 'var(--border-2)', color: 'var(--text)' },
              onclick: () => { st.base = sid; delete st.addons[sid]; mountApp(); },
            }, PRICING_SERVICES[sid].label))),
          p.id === 'termite'
            ? el('div', { class: 'rounded-lg p-2.5 text-center', style: { background: 'var(--card)' } },
                el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Annual · 1 visit'),
                el('div', { class: 'text-xl font-black tabular-nums', style: priceColor }, money(T.termite[1]), el('span', { class: 'text-[10px] font-semibold', style: { color: 'var(--text-muted)' } }, '/mo')))
            : el('div', { class: 'grid grid-cols-3 gap-1.5' },
                ...PRICING_FREQ.map(([k, lbl, visits], i) => {
                  const sel = on && st.freq === k;
                  return el('button', {
                    class: 'rounded-lg p-2 text-center border transition',
                    style: sel ? { borderColor: 'var(--accent)', background: 'var(--card)' } : { borderColor: 'transparent', background: 'var(--card)' },
                    onclick: () => { if (!on) st.base = p.services[0]; st.freq = k; mountApp(); },
                  },
                    el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, lbl),
                    el('div', { class: 'text-[9px]', style: { color: 'var(--text-subtle)' } }, visits + ' visits'),
                    el('div', { class: 'text-lg font-black tabular-nums mt-0.5', style: priceColor }, money(prices[i]), el('span', { class: 'text-[10px] font-semibold', style: { color: 'var(--text-muted)' } }, '/mo')));
                })));
      })));
  wrap.append(baseCard);

  // ── 2. Add-ons (the base service is excluded — it's already the plan) ──
  const addonCard = el('div', { class: 'card p-5' },
    secTitle('2 · Add-ons', 'Any of these on top of the base plan · per month'),
    el('div', { class: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
      ...T.addons.filter(([id]) => id !== st.base).map(([id, init, mo]) => {
        const on = !!st.addons[id];
        return el('button', {
          class: 'flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition',
          style: on ? { borderColor: 'var(--accent)', background: 'rgba(223,100,58,.08)' } : { borderColor: 'var(--border)', background: 'var(--card-2)' },
          onclick: () => { if (on) delete st.addons[id]; else st.addons[id] = true; mountApp(); },
        },
          el('div', { class: 'flex items-center gap-2 min-w-0' },
            el('span', { class: 'inline-flex items-center justify-center rounded border text-[10px] font-black shrink-0', style: { width: '16px', height: '16px', borderColor: on ? 'var(--accent)' : 'var(--border-2)', background: on ? 'var(--accent)' : 'transparent', color: 'var(--accent-text)' } }, on ? '✓' : ''),
            el('span', { class: 'text-xs font-semibold truncate' }, PRICING_SERVICES[id].label)),
          el('div', { class: 'text-right tabular-nums shrink-0' },
            el('div', { class: 'text-xs font-black', style: priceColor }, '+' + money(mo) + '/mo'),
            el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, 'initial ' + money(init))));
      })));
  wrap.append(addonCard);

  // ── 3. One-time services (Standard / Loyalty only) ──
  if (T.onetime) {
    wrap.append(el('div', { class: 'card p-5' },
      el('div', { class: 'flex items-baseline justify-between gap-3 mb-2 flex-wrap' },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, '3 · One-time services'),
        el('div', { class: 'inline-flex rounded-lg border overflow-hidden', style: { borderColor: 'var(--border-2)' } },
          ...[['new', 'New customer'], ['current', 'Current customer']].map(([v, l]) => el('button', {
            class: 'px-2.5 py-1 text-[11px] font-semibold transition',
            style: st.customer === v ? { background: 'var(--accent)', color: 'var(--accent-text)' } : { color: 'var(--text-muted)' },
            onclick: () => { st.customer = v; mountApp(); },
          }, l)))),
      el('div', { class: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' } },
        ...PRICING_ONETIME.map(([id, label, nw, cur]) => {
          const on = !!st.onetime[id];
          const price = st.customer === 'current' ? cur : nw;
          return el('button', {
            class: 'flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-left transition',
            style: on ? { borderColor: 'var(--accent)', background: 'rgba(223,100,58,.08)' } : { borderColor: 'var(--border)', background: 'var(--card-2)' },
            onclick: () => { if (on) delete st.onetime[id]; else st.onetime[id] = true; mountApp(); },
          },
            el('div', { class: 'flex items-center gap-2 min-w-0' },
              el('span', { class: 'inline-flex items-center justify-center rounded border text-[10px] font-black shrink-0', style: { width: '16px', height: '16px', borderColor: on ? 'var(--accent)' : 'var(--border-2)', background: on ? 'var(--accent)' : 'transparent', color: 'var(--accent-text)' } }, on ? '✓' : ''),
              el('span', { class: 'text-xs font-semibold truncate' }, label)),
            el('div', { class: 'text-xs font-black tabular-nums shrink-0', style: priceColor }, money(price)));
        }))));
  }

  // ── Quote (pinned at the bottom) ──
  const q = pricingQuote(st);
  const quote = el('div', { class: 'card p-5', style: { position: 'sticky', bottom: '12px', borderColor: 'var(--accent)', boxShadow: 'var(--shadow-lg)' } },
    el('div', { class: 'flex items-start justify-between gap-4 flex-wrap' },
      el('div', { class: 'min-w-0 flex-1' },
        el('div', { class: 'flex items-center gap-2 mb-1' },
          el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Quote · ' + T.label),
          T.badge ? el('span', { class: 'px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider', style: { background: 'var(--accent)', color: 'var(--accent-text)' } }, T.badge) : null),
        el('div', { class: 'flex flex-col gap-0.5' },
          ...q.lines.map(l => el('div', { class: 'flex items-center justify-between gap-3 text-[11px]' },
            el('span', { class: l.kind === 'base' ? 'font-semibold' : '', style: l.kind === 'base' ? {} : { color: 'var(--text-muted)' } }, l.label),
            el('span', { class: 'tabular-nums whitespace-nowrap', style: { color: 'var(--text-muted)' } }, money(l.init) + ' initial' + (l.mo ? ' · ' + money(l.mo) + '/mo' : '')))))),
      el('div', { class: 'flex gap-3 shrink-0' },
        el('div', { class: 'rounded-xl px-4 py-3 text-center', style: { background: 'var(--card-2)' } },
          el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'Total initial'),
          el('div', { class: 'text-2xl font-black tabular-nums', style: priceColor }, money(q.init))),
        el('div', { class: 'rounded-xl px-4 py-3 text-center', style: { background: 'var(--accent)', color: 'var(--accent-text)' } },
          el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { opacity: '.85' } }, 'Total monthly'),
          el('div', { class: 'text-2xl font-black tabular-nums' }, money(q.mo), el('span', { class: 'text-xs font-semibold' }, '/mo'))),
        el('div', { class: 'rounded-xl px-4 py-3 text-center hidden sm:block', style: { background: 'var(--card-2)' }, title: 'Initial + 11 monthly payments (one-time services included in the initial)' },
          el('div', { class: 'text-[9px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, 'First-year value'),
          el('div', { class: 'text-2xl font-black tabular-nums' }, money(q.acv))))),
    el('div', { class: 'flex items-center justify-between gap-3 mt-3 flex-wrap' },
      el('div', { class: 'text-[10px]', style: { color: 'var(--text-muted)' } }, 'Add-ons and one-time services are charged with the initial · monthly is the recurring total'),
      el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)', color: 'var(--text-muted)' }, onclick: () => { st.addons = {}; st.onetime = {}; mountApp(); } }, 'Clear add-ons')));
  wrap.append(quote);
  return wrap;
}

registerRiddModule({
  id: 'pricing',
  label: 'Pricing',
  title: 'PRICING',
  icon: () => (typeof svg === 'function' ? svg('<path d="M20 7h-9"/><path d="M14 17H5"/><circle cx="17" cy="17" r="3"/><circle cx="7" cy="7" r="3"/>') : el('span', {}, '$')),
  canView: () => true,
  render: () => viewPricing(),
});
