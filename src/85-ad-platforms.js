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
// Account → office (Settings → Configurations → Ad accounts, per Isaac):
// every campaign in the account goes to that office — the Google LSA
// accounts are one office each. Key = platform|account id.
function adAccountKey(r) { return r.platform + '|' + r.acct; }
function adAccountOfficeMap() { const R = (typeof _adminRules === 'function') ? _adminRules() : null; return (R && R.adAccountOffice) || {}; }
function setAdAccountOffice(key, val) {
  const m = Object.assign({}, adAccountOfficeMap());
  if (val == null) delete m[key]; else m[key] = val;
  _setAdminRule('adAccountOffice', m);
}
// Order: campaign override → account's office → office named in the
// campaign. '' = company-wide, 'OFFICE' = that office, absent = next rule.
function adOfficesOf(r, branches) {
  const o = adCampaignOfficeMap()[adCampaignKey(r)];
  if (o === '') return [];
  if (o) return [o];
  const a = adAccountOfficeMap()[adAccountKey(r)];
  if (a === '') return [];
  if (a) return [a];
  return adAutoOffices(r, branches);
}

// Settings → Configurations: map each ad account ID to a branch.
function reportingAdAccountsPanel() {
  const y = new Date().getFullYear();
  if (typeof reportingLoadAdSpend === 'function') reportingLoadAdSpend(y);
  const S = (state._adSpend || {})[y] || {};
  const branches = (typeof _mktgBranchList === 'function') ? _mktgBranchList(y).all : [];
  const muted = { color: 'var(--text-muted)' };
  const admin = isAdminRole(state.profile?.role);
  const wrap = (body) => el('div', { class: 'card p-3', id: 'cfg-ad-accounts' },
    el('div', { class: 'flex items-center gap-3 flex-wrap mb-2' },
      el('div', { class: 'text-sm font-bold' }, 'Ad accounts → branch'),
      el('div', { class: 'text-[11px]', style: muted }, 'Facebook + Google Ads accounts from Windsor. Pick a branch and every campaign in that account counts toward it on Marketing → Metrics. Auto = the branch named in each campaign (e.g. “RIDD Atlanta – General Search”); Company-wide = counted in company totals only. A single campaign can still be overridden on the Metrics campaigns card.')),
    body);
  if (!S.rows) return wrap(el('div', { class: 'text-[11px] py-3', style: S.error ? { color: '#DC2626' } : muted }, S.error ? 'Couldn’t pull the ad accounts: ' + S.error : 'Pulling ad accounts from Windsor…'));
  const by = new Map();
  for (const r of S.rows) {
    const k = adAccountKey(r);
    const x = by.get(k) || { k, r, platform: r.platform, acct: r.acct, name: r.acctName, spend: 0, camps: new Set(), provs: new Set(), auto: new Set() };
    x.spend += r.spend || 0; x.camps.add(r.campaign); x.provs.add(adProviderOf(r));
    for (const o of adAutoOffices(r, branches)) x.auto.add(o);
    by.set(k, x);
  }
  const list = [...by.values()].sort((a, b) => a.platform.localeCompare(b.platform) || b.spend - a.spend);
  const map = adAccountOfficeMap();
  const unassigned = list.filter(x => map[x.k] == null && !x.auto.size);
  const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, t);
  const td = (v, st) => el('td', { class: 'px-2 py-1.5 whitespace-nowrap', style: st || {} }, v == null || v === '' ? '—' : v);
  const sel = (x) => {
    const o = map[x.k];
    const autoLbl = 'Auto · ' + (x.auto.size ? [...x.auto].map(_mktgTC).join(' + ') : 'none found → company-wide');
    if (!admin) return o === '' ? 'Company-wide' : o ? _mktgTC(o) : autoLbl;
    return el('select', { class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: Object.assign({ borderColor: 'var(--border-2)', background: 'var(--card)', maxWidth: '260px' }, o == null && !x.auto.size ? { borderColor: '#DC2626' } : {}),
      onchange: (e) => { const v = e.target.value; setAdAccountOffice(x.k, v === '__auto' ? null : v === '__cw' ? '' : v); mountApp(); } },
      el('option', { value: '__auto', selected: o == null }, autoLbl),
      el('option', { value: '__cw', selected: o === '' }, 'Company-wide (no branch)'),
      ...branches.map(b => el('option', { value: b, selected: o === b }, _mktgTC(b))));
  };
  return wrap(el('div', {},
    unassigned.length ? el('div', { class: 'text-[11px] mb-2', style: { color: '#DC2626' } }, unassigned.length + ' account' + (unassigned.length === 1 ? '' : 's') + ' (' + fmt.usd0(unassigned.reduce((t, x) => t + x.spend, 0)) + ' this year) have no branch yet — outlined in red.') : null,
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', {}, th('Platform'), th('Account ID'), th('Account name'), th('Provider'), th('Campaigns'), th(y + ' spend'), th('Branch'))),
      el('tbody', {}, ...list.map(x => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(x.platform === 'facebook' ? 'Facebook' : 'Google Ads'), td(x.acct, { fontFamily: 'var(--font-mono, ui-monospace, monospace)' }), td(x.name),
        td([...x.provs].join(', ')), td(x.camps.size), td(fmt.usd0(x.spend)), td(sel(x)))))))));
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
  for (const r of rows) {
    if (String(r.ym).slice(0, 4) !== String(year)) continue;
    const mi = Number(String(r.ym).slice(5, 7)) - 1; if (!(mi >= 0 && mi < 12)) continue;
    const prov = adProviderOf(r); has.add(prov);
    ents.push({ prov, mi, offices: adOfficesOf(r, branches), spend: r.spend || 0, clicks: r.clicks || 0, impr: r.impr || 0, leads: r.leads || 0 });
  }
  const cell = (chs, bs, i, f) => {
    let t = 0;
    for (const e of ents) {
      if (e.mi !== i || (chs && !chs.includes(e.prov))) continue;
      if (!bs) { t += e[f]; continue; }
      if (!e.offices.length) continue;
      const n = e.offices.filter(o => bs.includes(o)).length;
      if (n) t += e[f] * n / e.offices.length;
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
    const auto = adAutoOffices(x.r, branches);
    const autoLbl = 'Auto · ' + (auto.length ? auto.map(_mktgTC).join(' + ') : 'company-wide');
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
