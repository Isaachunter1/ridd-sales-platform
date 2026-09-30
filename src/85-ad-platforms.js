// ┌─ src/85-ad-platforms.js ─────────────────────────────────────────────────
// │ Facebook / Google Ads through Windsor (per Isaac, Sep 30) — monthly spend,
// │ clicks, impressions and platform-reported leads by campaign, fed into
// │ Marketing → Metrics. Each campaign maps to an office from its name (office
// │ name or abbreviation: "GRAVITATE | ABO | VB", "RIDD Atlanta - General
// │ Search"), overridable per campaign; unmatched = company-wide.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const AD_OFFICE_ALIASES = { MB: 'MYRTLE BEACH', ATL: 'ATLANTA', CHS: 'CHARLESTON', RAL: 'RALEIGH', VB: 'VIRGINIA BEACH', DEST: 'DESTIN', SLC: 'SALT LAKE', DET: 'DETROIT', LR: 'LITTLE ROCK', WILM: 'WILMINGTON' };
const AD_PROVIDERS = ['Facebook', 'Google Ads', 'Google Local Services'];

function reportingLoadAdSpend(year, force) {
  state._adSpend = state._adSpend || {};
  const cur = state._adSpend[year];
  if (!force && cur && (cur.rows || cur.loading || (cur.failAt && Date.now() - cur.failAt < 120000))) return;
  state._adSpend[year] = { loading: true, rows: cur && cur.rows ? cur.rows : null };
  _apiAuthHeaders({ accept: 'application/json' })
    .then(h => fetch('/api/ad-spend?year=' + year + (force ? '&_=' + Date.now() : ''), { headers: h }))
    .then(r => r.ok ? r.json() : r.json().catch(() => ({})).then(j => { throw new Error(j.error || ('HTTP ' + r.status)); }))
    .then(j => { state._adSpend[year] = { rows: j.rows || [], pulledAt: j.pulledAt, errors: j.errors || [] }; mountApp(); })
    .catch(e => { state._adSpend[year] = { failAt: Date.now(), error: String((e && e.message) || e), rows: cur && cur.rows ? cur.rows : null }; mountApp(); });
}
function adProviderOf(r) {
  if (r.platform === 'facebook') return 'Facebook';
  return (r.type === 'LOCAL_SERVICES' || /^LocalServicesCampaign/i.test(r.campaign)) ? 'Google Local Services' : 'Google Ads';
}
function adCampaignKey(r) { return r.platform + '|' + r.acct + '|' + r.campaign; }
function adCampaignOfficeMap() { const R = (typeof _adminRules === 'function') ? _adminRules() : null; return (R && R.adCampaignOffice) || {}; }
function setAdCampaignOffice(key, val) {
  const m = Object.assign({}, adCampaignOfficeMap());
  if (val == null) delete m[key]; else m[key] = val;
  _setAdminRule('adCampaignOffice', m);
}
// Office names / abbreviations found in the campaign or account name.
function adAutoOffices(r, branches) {
  const norm = (s) => ' ' + String(s || '').toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim() + ' ';
  const text = norm(r.campaign + ' ' + r.acctName);
  const hit = new Set();
  const find = (name) => branches.find(b => b === name) || branches.find(b => b.includes(name) || name.includes(b));
  for (const b of branches) if (text.includes(norm(b))) hit.add(b);
  for (const [ab, full] of Object.entries(AD_OFFICE_ALIASES)) if (text.includes(' ' + ab + ' ') || text.includes(norm(full))) { const b = find(full); if (b) hit.add(b); }
  return [...hit].sort();
}
// Account → branch (Settings → Connections → Ad accounts, per Isaac).
// Assigned per ACCOUNT × PROVIDER (per Isaac, Sep 30): an account running
// both Google PPC (Search) and LSA campaigns gets a line for each. Targets
// are a multi-select — any offices (spend splits evenly between them) and/or
// a whole company ("ENT:RPC" / "ENT:RPS") for accounts that can't be pinned
// to an office (the Facebook brand accounts, the main Google Ads account).
// A company target counts in that company's totals (and RIDD's), never in a
// single office. Stored value: array of targets; [] = company-wide; absent
// = auto (office named in each campaign). Legacy string values still read.
function adAccountKey(r) { return r.platform + '|' + r.acct; }
function adAcctProvKey(r) { return adAccountKey(r) + '|' + adProviderOf(r); }
function adAccountOfficeMap() { const R = (typeof _adminRules === 'function') ? _adminRules() : null; return (R && R.adAccountOffice) || {}; }
function setAdAccountOffice(key, val) {
  const m = Object.assign({}, adAccountOfficeMap());
  if (val == null) delete m[key]; else m[key] = val;
  _setAdminRule('adAccountOffice', m);
}
function _adTargets(v) { if (v == null) return null; if (Array.isArray(v)) return v.slice(); return v === '' ? [] : [v]; }
function adAccountTargets(r) {
  const m = adAccountOfficeMap();
  const v = m[adAcctProvKey(r)];
  return v !== undefined ? _adTargets(v) : _adTargets(m[adAccountKey(r)]);
}
const AD_ENT = 'ENT:';
function adEntityLabel(t) { const k = String(t).slice(AD_ENT.length); return 'All ' + ((typeof COMPANY_NAMES !== 'undefined' && COMPANY_NAMES[k]) || k); }
function adTargetLabel(t) { return String(t).startsWith(AD_ENT) ? adEntityLabel(t) : (typeof _mktgTC === 'function' ? _mktgTC(t) : t); }
// Order: campaign override → account × provider targets → office named in
// the campaign. Returns targets (offices and/or ENT:<company>); [] = company-wide.
function adOfficesOf(r, branches) {
  const o = adCampaignOfficeMap()[adCampaignKey(r)];
  if (o === '') return [];
  if (o) return [o];
  const a = adAccountTargets(r);
  if (a) return a;
  return adAutoOffices(r, branches);
}

// Settings → Connections: map each ad account (× PPC / LSA) to branches.
function reportingAdAccountsPanel() {
  const y = new Date().getFullYear();
  if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(y);
  const S = (state._adSpend || {})[y] || {};
  const BL = (typeof _mktgBranchList === 'function') ? _mktgBranchList(y) : { all: [], byEntity: {} };
  const branches = BL.all;
  const ents = Object.keys(BL.byEntity || {}).filter(k => (BL.byEntity[k] || []).length);
  const muted = { color: 'var(--text-muted)' };
  const admin = isAdminRole(state.profile?.role);
  const wrap = (body) => el('div', { class: 'card p-3', id: 'cfg-ad-accounts' },
    el('div', { class: 'flex items-center gap-3 flex-wrap mb-2' },
      el('div', { class: 'text-sm font-bold' }, 'Ad accounts → branch'),
      el('div', { class: 'text-[11px]', style: muted }, 'Facebook + Google Ads accounts from Windsor, one line per account and type (PPC / LSA). Pick one or more offices (spend splits evenly), or a whole company for accounts that can’t be pinned to an office — company spend counts in that company’s totals, not in any single office. Auto = the office named in each campaign. A single campaign can still be overridden on the Metrics campaigns card.')),
    body);
  if (!S.rows) return wrap(el('div', { class: 'text-[11px] py-3', style: S.error ? { color: '#DC2626' } : muted }, S.error ? 'Couldn’t pull the ad accounts: ' + S.error : 'Pulling ad accounts from Windsor…'));
  const by = new Map();
  for (const r of S.rows) {
    const k = adAcctProvKey(r);
    const x = by.get(k) || { k, ak: adAccountKey(r), r, platform: r.platform, acct: r.acct, name: r.acctName, prov: adProviderOf(r), spend: 0, camps: new Set(), auto: new Set() };
    x.spend += r.spend || 0; x.camps.add(r.campaign);
    for (const o of adAutoOffices(r, branches)) x.auto.add(o);
    by.set(k, x);
  }
  const list = [...by.values()].sort((a, b) => a.platform.localeCompare(b.platform) || b.spend - a.spend);
  const typeOf = (x) => x.platform === 'facebook' ? 'Facebook' : x.prov === 'Google Local Services' ? 'LSA' : 'PPC';
  const unassigned = list.filter(x => adAccountTargets(x.r) == null && !x.auto.size);
  const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, t);
  const td = (v, st) => el('td', { class: 'px-2 py-1.5 whitespace-nowrap', style: st || {} }, v == null || v === '' ? '—' : v);
  const summary = (x, t) => {
    if (t == null) return 'Auto · ' + (x.auto.size ? [...x.auto].map(_mktgTC).join(' + ') : 'none found → company-wide');
    if (!t.length) return 'Company-wide';
    const e = t.filter(v => String(v).startsWith(AD_ENT)).map(adEntityLabel), o = t.filter(v => !String(v).startsWith(AD_ENT));
    const parts = [...e, ...(o.length <= 2 ? o.map(_mktgTC) : [o.length + ' offices'])];
    return parts.join(' + ');
  };
  const cbx = (checked, onChange) => { const c = el('input', { type: 'checkbox', style: { accentColor: 'var(--accent)' }, onchange: (ev) => onChange(ev.target.checked) }); c.checked = checked; return c; };
  const picker = (x) => {
    const t = adAccountTargets(x.r);
    const label = summary(x, t);
    if (!admin) return label;
    const save = (v) => { setAdAccountOffice(x.k, v); if (x.k !== x.ak && adAccountOfficeMap()[x.ak] !== undefined) setAdAccountOffice(x.ak, null); mountApp(); };
    const cur = t || [];
    const toggle = (v, on) => { const n = new Set(cur); if (on) n.add(v); else n.delete(v); save([...n]); };
    const key = 'ad:' + x.k, open = state._adAcctOpen === key;
    const opt = (lbl, on, fn) => el('label', { class: 'w-full flex items-center gap-2 px-2.5 py-1 rounded-lg text-[11px] font-semibold cursor-pointer', style: { background: on ? 'var(--card-2)' : 'transparent', color: 'var(--text)' } }, cbx(on, fn), el('span', { class: 'flex-1' }, lbl));
    const head = (t2) => el('div', { class: 'px-2 pt-2 pb-1 text-[10px] uppercase tracking-widest font-semibold', style: { color: 'var(--text-subtle)' } }, t2);
    const wrapEl = el('div', { class: 'relative', 'data-dd': key });
    const panel = el('div', { class: 'card absolute p-1.5', style: { top: 'calc(100% + 6px)', right: '0', width: '260px', maxWidth: 'calc(100vw - 32px)', maxHeight: '360px', overflowY: 'auto', zIndex: '40', boxShadow: 'var(--shadow-lg)', display: open ? 'block' : 'none' }, onclick: (e) => e.stopPropagation() },
      open ? el('div', {},
        el('div', { class: 'flex items-center gap-1 px-1.5 pb-1.5 mb-1', style: { borderBottom: '1px solid var(--border)' } },
          ...[['Auto', () => save(null), t == null], ['Company-wide', () => save([]), !!t && !t.length]].map(([l, fn, on]) => el('button', { class: 'rounded-lg px-2 py-0.5 text-[10px] font-bold', style: { background: on ? 'rgba(223,100,58,.12)' : 'var(--card-2)', color: on ? 'var(--accent)' : 'var(--text-muted)', border: '1px solid var(--border)' }, onclick: fn }, l))),
        ents.length > 1 ? head('Whole company') : null,
        ...(ents.length > 1 ? ents.map(k => opt(adEntityLabel(AD_ENT + k), cur.includes(AD_ENT + k), (on) => toggle(AD_ENT + k, on))) : []),
        ...ents.flatMap(k => [head(ents.length > 1 ? ((typeof COMPANY_NAMES !== 'undefined' && COMPANY_NAMES[k]) || k) + ' offices' : 'Offices'),
          ...(BL.byEntity[k] || []).map(b => opt(_mktgTC(b), cur.includes(b), (on) => toggle(b, on)))])) : null);
    const btn = el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold cursor-pointer flex items-center justify-between gap-2',
      style: { borderColor: t == null && !x.auto.size ? '#DC2626' : t != null ? 'var(--accent)' : 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', width: '240px', minWidth: '240px', maxWidth: '240px', justifyContent: 'space-between', textAlign: 'left' }, title: label,
      onclick: (e) => { e.stopPropagation(); state._adAcctOpen = open ? null : key; mountApp(); } },
      el('span', { class: 'truncate' }, label), el('span', { style: { fontSize: '9px', opacity: .7 } }, '▾'));
    wrapEl.append(btn, panel);
    if (open) {
      try { clampDropdownPanel(panel); } catch (err) { /* optional helper */ }
      setTimeout(() => document.addEventListener('mousedown', function closer(ev) { if (!(ev.target.closest && ev.target.closest('[data-dd="' + key + '"]'))) { document.removeEventListener('mousedown', closer); if (state._adAcctOpen === key) { state._adAcctOpen = null; mountApp(); } } }), 0);
    }
    return wrapEl;
  };
  return wrap(el('div', {},
    unassigned.length ? el('div', { class: 'text-[11px] mb-2', style: { color: '#DC2626' } }, unassigned.length + ' account line' + (unassigned.length === 1 ? '' : 's') + ' (' + fmt.usd0(unassigned.reduce((t, x) => t + x.spend, 0)) + ' this year) have no branch yet — outlined in red.') : null,
    el('div', { class: 'scroll-x', style: { paddingBottom: state._adAcctOpen ? '300px' : '0' } }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', {}, th('Platform'), th('Type'), th('Account ID'), th('Account name'), th('Campaigns'), th(y + ' spend'), th('Branch'))),
      el('tbody', {}, ...list.map(x => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(x.platform === 'facebook' ? 'Facebook' : 'Google Ads'), td(typeOf(x)), td(x.acct, { fontFamily: 'var(--font-mono, ui-monospace, monospace)' }), td(x.name),
        td(x.camps.size), td(fmt.usd0(x.spend)), td(picker(x)))))))));
}
// Month × provider × office index for one year. A campaign on several
// offices ("Myrtle Beach + Wilmington") splits evenly between them.
function adPlatformIndex(year, branches) {
  const S = state._adSpend && state._adSpend[year];
  const rows = S && S.rows;
  if (!rows || !rows.length) return null;
  const mapSig = JSON.stringify(adCampaignOfficeMap()) + JSON.stringify(adAccountOfficeMap());
  const memo = state._adIdxMemo;
  if (memo && memo.rows === rows && memo.mapSig === mapSig && memo.bs === branches.join(',')) return memo.idx;
  const ents = [];
  const has = new Set();
  // A company target ("ENT:RPS") = that company's offices, counted whole
  // only when the scope covers all of them (the company / RIDD rows).
  const entBranches = (k) => branches.filter(b => typeof _mktgEntityOf === 'function' && _mktgEntityOf(b) === k);
  for (const r of rows) {
    if (String(r.ym).slice(0, 4) !== String(year)) continue;
    const mi = Number(String(r.ym).slice(5, 7)) - 1; if (!(mi >= 0 && mi < 12)) continue;
    const prov = adProviderOf(r); has.add(prov);
    const tg = adOfficesOf(r, branches);
    const pools = tg.filter(t => String(t).startsWith(AD_ENT)).map(t => entBranches(String(t).slice(AD_ENT.length))).filter(l => l.length);
    ents.push({ prov, mi, offices: tg.filter(t => !String(t).startsWith(AD_ENT)), pools, spend: r.spend || 0, clicks: r.clicks || 0, impr: r.impr || 0, leads: r.leads || 0 });
  }
  const cell = (chs, bs, i, f) => {
    let t = 0;
    for (const e of ents) {
      if (e.mi !== i || (chs && !chs.includes(e.prov))) continue;
      if (!bs) { t += e[f]; continue; }
      const parts = e.offices.length + e.pools.length;
      if (!parts) continue;
      let n = e.offices.filter(o => bs.includes(o)).length;
      for (const pl of e.pools) if (pl.every(o => bs.includes(o))) n++;
      if (n) t += e[f] * n / parts;
    }
    return t;
  };
  const idx = { has, cell, ents };
  state._adIdxMemo = { rows, mapSig, bs: branches.join(','), idx };
  return idx;
}

// Campaign → office mapping card (Metrics, under the charts). Admins edit.
function adCampaignsCard(year, branches) {
  const S = (state._adSpend || {})[year] || {};
  const muted = { color: 'var(--text-muted)' };
  const refresh = el('button', { class: 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => reportingLoadAdSpend(year, true) }, S.loading ? 'Pulling…' : '↻ Refresh');
  const head = (extra) => el('div', { class: 'px-4 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
    el('h3', { class: 'text-sm font-bold' }, 'Ad platform campaigns · ' + year), extra || null, el('div', { class: 'ml-auto flex items-center gap-2' },
      S.pulledAt ? el('span', { class: 'text-[10px]', style: muted }, 'Facebook + Google via Windsor · pulled ' + new Date(S.pulledAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : null, refresh));
  if (!S.rows) return el('div', { class: 'card overflow-hidden' }, head(),
    el('div', { class: 'px-4 py-6 text-center text-[11px]', style: S.error ? { color: '#DC2626' } : muted }, S.error ? 'Couldn’t pull Facebook / Google: ' + S.error : 'Pulling Facebook and Google Ads from Windsor…'));
  const by = new Map();
  for (const r of S.rows) {
    if (String(r.ym).slice(0, 4) !== String(year)) continue;
    const k = adCampaignKey(r);
    const x = by.get(k) || { k, r, prov: adProviderOf(r), spend: 0, leads: 0, clicks: 0 };
    x.spend += r.spend || 0; x.leads += r.leads || 0; x.clicks += r.clicks || 0; by.set(k, x);
  }
  const list = [...by.values()].sort((a, b) => b.spend - a.spend);
  const map = adCampaignOfficeMap();
  const admin = isAdminRole(state.profile?.role);
  let cw = 0; for (const x of list) if (!adOfficesOf(x.r, branches).length) cw += x.spend;
  const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, t);
  const td = (v, st) => el('td', { class: 'px-2 py-1.5 whitespace-nowrap', style: st || {} }, v == null || v === '' ? '—' : v);
  const offSel = (x) => {
    const o = map[x.k];
    const inh = adAccountTargets(x.r);   // the account line's branches, when set
    const auto = inh != null ? inh : adAutoOffices(x.r, branches);
    const autoLbl = (inh != null ? 'Account · ' : 'Auto · ') + (auto.length ? auto.map(adTargetLabel).join(' + ') : 'company-wide');
    if (!admin) return (o === '' ? 'Company-wide' : o ? _mktgTC(o) : autoLbl);
    return el('select', { class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', maxWidth: '240px' },
      onchange: (e) => { const v = e.target.value; setAdCampaignOffice(x.k, v === '__auto' ? null : v === '__cw' ? '' : v); mountApp(); } },
      el('option', { value: '__auto', selected: o == null }, autoLbl),
      el('option', { value: '__cw', selected: o === '' }, 'Company-wide (no market)'),
      ...branches.map(b => el('option', { value: b, selected: o === b }, _mktgTC(b))));
  };
  const open = !!state._adCampOpen;
  return el('div', { class: 'card overflow-hidden' },
    head(el('span', { class: 'text-[11px]', style: muted }, list.length + ' campaigns · ' + fmt.usd0(list.reduce((t, x) => t + x.spend, 0)) + ' spend · ' + fmt.usd0(cw) + ' company-wide (counted in company totals, not in any market)')),
    S.errors && S.errors.length ? el('div', { class: 'px-4 py-2 text-[11px]', style: { color: '#DC2626' } }, S.errors.join(' · ')) : null,
    el('button', { class: 'w-full px-4 py-2 text-[11px] font-semibold text-left', style: { color: 'var(--accent)' }, onclick: () => { state._adCampOpen = !open; mountApp(); } },
      (open ? 'Hide' : 'Show') + ' campaigns → offices' + (admin ? ' (set any campaign’s office here)' : '')),
    open ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', {}, th('Provider'), th('Account'), th('Campaign'), th('Spend'), th('Platform leads'), th('Clicks'), th('Office'))),
      el('tbody', {}, ...list.map(x => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(x.prov), td(x.r.acctName ? x.r.acctName + ' · ' + x.r.acct : x.r.acct), td(x.r.campaign, { maxWidth: '360px', overflow: 'hidden', textOverflow: 'ellipsis' }),
        td(fmt.usd0(x.spend)), td(Math.round(x.leads).toLocaleString()), td(x.clicks.toLocaleString()), td(offSel(x))))))) : null);
}
