// ┌─ src/86-ghl-leads.js ────────────────────────────────────────────────────
// │ GoHighLevel leads (per Isaac, Sep 30) — every lead that hits the lead
// │ management system, from the hourly sync's compact file
// │ (reporting/ghl/leads.json.gz). Each GHL source / attribution label maps
// │ to a provider (Settings → Configurations → GoHighLevel sources); a lead's
// │ credit is the LAST PAID TOUCH across every GHL record for that person
// │ (same phone or email), else the lead's own source — so a PestBooker
// │ abandoned cart with a Facebook touch before it is a Facebook lead, and
// │ without one it's a PestBooker lead.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const GHL_PATH = 'ghl/leads.json.gz';
const GHL_NOT_LEAD = '__notlead', GHL_SELF = '__self';
const GHL_AUTO_RULES = [
  [/current customer/, GHL_NOT_LEAD],
  [/door to door|\bd2d\b/, GHL_NOT_LEAD],
  [/^crm\b|crm workflow|crm ui/, GHL_NOT_LEAD],
  [/do ?leads?/, 'DoLead'],
  [/local services|\blsa\b/, 'Google Local Services'],
  [/paid social|facebook|instagram|\bmeta\b|^fb\b|fbclid/, 'Facebook'],
  [/google ads|paid search|gclid|adwords|^google$|^gaw/, 'Google Ads'],
  [/service direct/, 'Service Direct'],
  [/\bangi\b|homeadvisor/, 'Angi'],
  [/elect ?gen/, 'ElectGen'],
  [/baton/, 'Baton'],
  [/pest ?net/, 'Pest Net'],
  [/pest ?booker/, 'PestBooker'],
  [/organic|direct traffic|social media|referral|ridd form|website/, 'Organic'],
];
function ghlSourceMap() { const R = (typeof _adminRules === 'function') ? _adminRules() : null; return (R && R.ghlSourceMap) || {}; }
function setGhlSourceMap(label, val) { const m = Object.assign({}, ghlSourceMap()); if (val == null) delete m[label]; else m[label] = val; _setAdminRule('ghlSourceMap', m); }
function ghlAutoProvider(label) { const s = String(label || '').toLowerCase().trim(); for (const [re, p] of GHL_AUTO_RULES) if (re.test(s)) return p; return ''; }
// → provider name, GHL_NOT_LEAD, or null (blank label).
function ghlProviderOf(label) {
  if (!label) return null;
  const o = ghlSourceMap()[label];
  if (o === GHL_SELF) return label;
  if (o) return o;
  const a = ghlAutoProvider(label);
  return a || label;
}
function ghlPaidSet() {
  const s = new Set((typeof reportingPaidSources === 'function') ? reportingPaidSources() : []);
  for (const p of (typeof AD_PROVIDERS !== 'undefined' ? AD_PROVIDERS : [])) s.add(p);
  if (s.size <= 3 && typeof MKTG_DEFAULT_CHANNELS !== 'undefined') for (const p of MKTG_DEFAULT_CHANNELS) s.add(p);
  return s;
}

async function ghlLoadLeads(force) {
  if (!force && state._ghl !== undefined) return;
  if (!supabase || (typeof DEMO !== 'undefined' && DEMO)) { state._ghl = { rows: [], labels: [] }; return; }
  state._ghl = null;
  try {
    const { data, error } = await supabase.storage.from('reporting').download(GHL_PATH + '?t=' + Date.now());
    if (error || !data) state._ghl = { missing: true, rows: [], labels: [] };
    else {
      const txt = await new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      const j = JSON.parse(txt);
      state._ghl = { at: j.at, backfillDone: !!j.backfillDone, labels: j.labels || [], rows: j.rows || [] };
    }
  } catch (e) { state._ghl = { error: String((e && e.message) || e), rows: [], labels: [] }; }
  mountApp();
}
async function ghlSyncNow() {
  try {
    const h = await _apiAuthHeaders({ accept: 'application/json' });
    const r = await fetch('/api/ghl-sync-now', { method: 'POST', headers: h });
    toast(r.ok ? 'GoHighLevel sync started — the first full pull takes ~10 min; refresh after.' : 'Could not start the sync (HTTP ' + r.status + ')', r.ok ? 'success' : 'error');
  } catch (e) { toast('Could not start the sync: ' + (e.message || e), 'error'); }
}

// ZIP → office from the FieldRoutes snapshot (most customers in that ZIP).
function _ghlZipOffice() {
  const subs = state.reportingSubscriptions || [];
  if (state._ghlZipMemo && state._ghlZipMemo.src === subs) return state._ghlZipMemo.map;
  const cnt = new Map();
  for (const r of subs) {
    const m = /(\d{5})/.exec(String(r.zip_code || r.zip || '')); if (!m) continue;
    const off = String(r.office_name || '').toUpperCase(); if (!off) continue;
    const c = cnt.get(m[1]) || new Map(); c.set(off, (c.get(off) || 0) + 1); cnt.set(m[1], c);
  }
  const map = new Map();
  for (const [z, c] of cnt) { let best = null, n = -1; for (const [o, k] of c) if (k > n) { best = o; n = k; } map.set(z, best); }
  state._ghlZipMemo = { src: subs, map };
  return map;
}

// Every GHL lead with its credited provider + office. Memoized on the file,
// the source map and the paid-channel list.
function ghlLeads() {
  const G = state._ghl;
  if (!G || !G.rows || !G.rows.length) return null;
  const paid = ghlPaidSet();
  const sig = JSON.stringify(ghlSourceMap()) + '|' + [...paid].sort().join(',');
  const zipOff = _ghlZipOffice();
  const memo = state._ghlMemo;
  if (memo && memo.rows === G.rows && memo.sig === sig && memo.zipOff === zipOff) return memo.out;
  const lab = G.labels;
  const pOf = (i) => i >= 0 ? ghlProviderOf(lab[i]) : null;
  // People: same phone or email = one person.
  const byPhone = new Map(), byEmail = new Map(); let nextId = 0;
  const pid = new Array(G.rows.length);
  G.rows.forEach((r, k) => {
    const p = r[4], e = r[5];
    let id = (p && byPhone.get(p)); if (id == null && e) id = byEmail.get(e);
    if (id == null) id = nextId++;
    if (p && !byPhone.has(p)) byPhone.set(p, id);
    if (e && !byEmail.has(e)) byEmail.set(e, id);
    pid[k] = id;
  });
  // Paid touches per person (date, provider), from source + both attributions.
  const touches = new Map();
  G.rows.forEach((r, k) => {
    for (const i of [r[1], r[2], r[3]]) { const pv = pOf(i); if (pv && paid.has(pv)) { const t = touches.get(pid[k]) || []; t.push([r[0], pv]); touches.set(pid[k], t); } }
  });
  const leads = [];
  const notLead = new Map();
  G.rows.forEach((r, k) => {
    const own = pOf(r[1]);
    if (own === GHL_NOT_LEAD) { notLead.set(lab[r[1]], (notLead.get(lab[r[1]]) || 0) + 1); return; }
    const t = touches.get(pid[k]);
    let credit = null, how = 'source';
    // The lead's own last attribution counts first when it's paid; then the
    // person's latest paid touch on or before this lead.
    const la = pOf(r[3]);
    if (la && paid.has(la)) { credit = la; how = 'last touch'; }
    else if (own && paid.has(own)) credit = own;
    else if (t) { let best = null; for (const x of t) if (x[0] <= r[0] && (!best || x[0] >= best[0])) best = x; if (best) { credit = best[1]; how = 'earlier paid touch'; } }
    if (!credit) credit = own || 'Unknown';
    leads.push({ d: r[0], mi: Number(r[0].slice(5, 7)) - 1, y: r[0].slice(0, 4), prov: credit, own: own || 'Unknown', how, office: zipOff.get(r[6]) || null, p: r[4], e: r[5] });
  });
  const out = { leads, notLead, people: nextId, phones: byPhone, emails: byEmail };
  state._ghlMemo = { rows: G.rows, sig, zipOff, out };
  return out;
}
// Month × provider × office counts for one year (Metrics).
function ghlLeadIndex(year) {
  const L = ghlLeads(); if (!L) return null;
  const Y = String(year);
  const ents = L.leads.filter(l => l.y === Y);
  const has = new Map(); for (const l of ents) has.set(l.prov, (has.get(l.prov) || 0) + 1);
  const cell = (chs, bs, i) => { let n = 0; for (const l of ents) { if (l.mi !== i) continue; if (chs && !chs.includes(l.prov)) continue; if (bs && !(l.office && bs.includes(l.office))) continue; n++; } return n; };
  return { has, cell, n: ents.length };
}
// Is this phone / email in GoHighLevel? (Lead reconciliation check.)
function ghlHasContact(phone, email) {
  const L = ghlLeads(); if (!L) return null;
  const p = String(phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1').slice(0, 10);
  const e = String(email || '').trim().toLowerCase();
  return !!((p && L.phones.has(p)) || (e && L.emails.has(e)));
}

// Settings → Configurations: GHL source → provider, sync status.
function reportingGhlSourcesPanel() {
  ghlLoadLeads();
  const G = state._ghl;
  const muted = { color: 'var(--text-muted)' };
  const admin = isAdminRole(state.profile?.role);
  const btn = 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold';
  const head = el('div', { class: 'flex items-center gap-3 flex-wrap mb-2' },
    el('div', { class: 'text-sm font-bold' }, 'GoHighLevel sources → provider'),
    el('div', { class: 'text-[11px] flex-1', style: muted, title: '' }, 'Every source and attribution GoHighLevel records, mapped to a provider. A lead is credited to the last PAID touch for that person (any of their GHL records, same phone or email); with no paid touch it keeps its own source (e.g. PestBooker). Not a new lead = left out of lead counts (door-to-door, CRM workflows, current customers). Paid channels = Lead sources config + Facebook / Google.'),
    G && G.at ? el('span', { class: 'text-[10px]', style: muted }, 'synced ' + new Date(G.at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (G.backfillDone ? '' : ' · history still loading')) : null,
    admin ? el('button', { class: btn, style: { borderColor: 'var(--border-2)' }, onclick: () => ghlSyncNow() }, '↻ Sync now') : null,
    el('button', { class: btn, style: { borderColor: 'var(--border-2)' }, onclick: () => { state._ghl = undefined; ghlLoadLeads(true); } }, 'Reload'));
  if (G === null) return el('div', { class: 'card p-3', id: 'cfg-ghl' }, head, el('div', { class: 'text-[11px] py-2', style: muted }, 'Loading GoHighLevel leads…'));
  if (!G || !G.rows.length) return el('div', { class: 'card p-3', id: 'cfg-ghl' }, head, el('div', { class: 'text-[11px] py-2', style: G && G.error ? { color: '#DC2626' } : muted },
    G && G.error ? 'Couldn’t read the GoHighLevel file: ' + G.error : 'No GoHighLevel sync yet — run the migration, then Sync now (it also runs every hour).'));
  const cnt = new Map();
  for (const r of G.rows) for (const [j, i] of [[0, r[1]], [1, r[2]], [2, r[3]]]) { if (i < 0) continue; const c = cnt.get(i) || [0, 0]; c[j === 0 ? 0 : 1]++; cnt.set(i, c); }
  const list = [...cnt.entries()].map(([i, c]) => ({ label: G.labels[i], asSource: c[0], asAttr: c[1] })).sort((a, b) => (b.asSource - a.asSource) || (b.asAttr - a.asAttr));
  const map = ghlSourceMap();
  const provs = [...new Set([...(typeof MKTG_DEFAULT_CHANNELS !== 'undefined' ? MKTG_DEFAULT_CHANNELS : []), ...AD_PROVIDERS, 'PestBooker', 'Organic', ...Object.values(map).filter(v => v && v !== GHL_NOT_LEAD && v !== GHL_SELF)])].sort();
  const paid = ghlPaidSet();
  const L = ghlLeads();
  const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, t);
  const td = (v, st) => el('td', { class: 'px-2 py-1.5 whitespace-nowrap', style: st || {} }, v == null || v === '' ? '—' : v);
  const sel = (x) => {
    const o = map[x.label]; const a = ghlAutoProvider(x.label);
    const autoLbl = 'Auto · ' + (a === GHL_NOT_LEAD ? 'Not a new lead' : (a || x.label + ' (own source)'));
    if (!admin) return o == null ? autoLbl : o === GHL_NOT_LEAD ? 'Not a new lead' : o === GHL_SELF ? 'Its own source' : o;
    return el('select', { class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', maxWidth: '240px' },
      onchange: (e) => { const v = e.target.value; setGhlSourceMap(x.label, v === '__auto' ? null : v); mountApp(); } },
      el('option', { value: '__auto', selected: o == null }, autoLbl),
      el('option', { value: GHL_SELF, selected: o === GHL_SELF }, 'Its own source (' + x.label + ')'),
      el('option', { value: GHL_NOT_LEAD, selected: o === GHL_NOT_LEAD }, 'Not a new lead'),
      ...provs.map(p => el('option', { value: p, selected: o === p }, p)));
  };
  const open = !!state._ghlCfgOpen;
  const y = String(new Date().getFullYear());
  const yLeads = L ? L.leads.filter(l => l.y === y) : [];
  const noOff = yLeads.filter(l => !l.office).length;
  return el('div', { class: 'card p-3', id: 'cfg-ghl' }, head,
    el('div', { class: 'text-[11px] mb-2' }, G.rows.length.toLocaleString() + ' GoHighLevel contacts · ' + (L ? L.leads.length.toLocaleString() + ' new leads (' + yLeads.length.toLocaleString() + ' in ' + y + ') · ' + [...L.notLead.values()].reduce((t, n) => t + n, 0).toLocaleString() + ' not new leads' : '') +
      (yLeads.length ? ' · ' + Math.round(noOff / yLeads.length * 100) + '% with no office (ZIP not in FieldRoutes)' : '')),
    el('button', { class: 'text-[11px] font-semibold', style: { color: 'var(--accent)' }, onclick: () => { state._ghlCfgOpen = !open; mountApp(); } }, (open ? 'Hide' : 'Show') + ' the ' + list.length + ' sources'),
    open ? el('div', { class: 'scroll-x mt-2' }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', {}, th('GoHighLevel label'), th('Contacts (as source)'), th('As attribution'), th('Provider'), th('Paid?'))),
      el('tbody', {}, ...list.map(x => { const pv = ghlProviderOf(x.label); return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(x.label), td(x.asSource.toLocaleString()), td(x.asAttr.toLocaleString()), td(sel(x)), td(pv === GHL_NOT_LEAD ? '—' : paid.has(pv) ? 'Paid' : 'Organic / own', paid.has(pv) ? { color: 'var(--ok)', fontWeight: '600' } : muted)); })))) : null);
}
