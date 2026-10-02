// ┌─ src/73-attribution.js ──────────────────────────────────────────────────
// │ Lead reconciliation (per Isaac, Sep 30) — Marketing → Providers.
// │ Upload each lead provider's lead report; the app matches every lead to
// │ the CRM (phone → email → last name + ZIP) and applies LAST-TOUCH
// │ attribution across every provider uploaded: when a customer was a lead
// │ with several providers, the latest lead on or before the sale wins.
// │ Output: who is correctly sourced, who has no source, who is mis-sourced,
// │ who was already a customer, and a to-do list of the exact FieldRoutes
// │ subscriptions whose source must change (exportable). Replaces pulling
// │ reports + XLOOKUPs by hand.
// │ Uploads persist for every admin in storage: reporting/attribution/leads.json.gz
// └──────────────────────────────────────────────────────────────────────────
const ATTR_PATH = 'attribution/leads.json.gz';
const ATTR_WINDOW_DAYS = 60;   // a sale counts for a lead when sold within 60 days after the lead (1 day grace before, for date/time-zone slop)
// LEAD FEEDS (per Isaac, Oct 2): GoHighLevel is the main feed — every lead
// that hits the lead system, synced hourly, with its paid channel from the
// GHL source / attribution (Facebook and Google included). Provider lead
// reports uploaded here are the BACKUP: they add leads GHL never got and
// de-duplicate against GHL (same provider + same phone/email within 3 days).
// RULE: last touch — the last paid lead channel on or before the sale wins.
// ONE EXCEPTION, the priority window: a provider on a cost-per-job deal
// (ElectGen, 7 days) wins the sale whenever it sent a lead within its window
// before the sale, even if another channel touched after. Editable on the
// Attribution screen; saved for every admin (adminRules.attrPriority).
const ATTR_PRIORITY_DEFAULT = { ElectGen: 7 };
// Sources a lead never overwrites (like Door to Door): the sale keeps its
// FieldRoutes source even when a paid lead exists. Editable on the screen
// (adminRules.attrKeep).
const ATTR_KEEP_DEFAULT = ['6 Brothers', 'Referral', 'Sellify', 'Upsell - Service Pro'];   // Sellify / 6 Brothers never send leads through GoHighLevel, so a missing lead proves nothing   // PestBooker is a booking tool — a paid lead can sit behind it, so it is NOT protected
function attrKeep() { const r = (typeof _adminRules === 'function') ? _adminRules() : null; const v = r && r.attrKeep; return Array.isArray(v) ? v : ATTR_KEEP_DEFAULT; }
function setAttrKeep(source, on) {
  if (_attrRulesLocked()) return;
  const set = new Set(attrKeep()); if (on) set.add(source); else set.delete(source);
  _setAdminRule('attrKeep', [...set].sort()); state._attrMemo = null;
}
function attrPriority() { const r = (typeof _adminRules === 'function') ? _adminRules() : null; const v = r && r.attrPriority; return (v && typeof v === 'object') ? v : ATTR_PRIORITY_DEFAULT; }
// The rules are shared settings: only admins can change them (the server rejects anyone else).
function _attrRulesLocked() { if (isAdminRole(state.profile && state.profile.role)) return false; toast('Only an admin can change the attribution rules', 'error'); return true; }
function setAttrPriority(provider, days) {
  if (_attrRulesLocked()) return;
  const m = Object.assign({}, attrPriority());
  if (days == null) delete m[provider]; else m[provider] = Math.max(1, Math.round(Number(days) || 7));
  _setAdminRule('attrPriority', m); state._attrMemo = null;
}
function _attrUseGhl() { const A = state._attr; return !A || A.useGhl !== false; }
function _attrActiveOnly() { const A = state._attr; return !A || A.activeOnly !== false; }
// Active subscription = FieldRoutes status Active with no cancel date (same test the rest of Reporting uses).
// …and it must have at least a scheduled or completed appointment (per Isaac):
// initial Pending (scheduled) or Completed, a serviced date, a booked initial
// appointment, or any completed service. An active sub with nothing on the
// books is not a real sale yet.
function _attrHasAppt(r) { return /completed|pending/i.test(String(r.initial_status || '')) || !!r.initial_serviced_date || !!r.initial_appt_date || (Number(r.subscription_completed_services) || 0) > 0; }
function _attrSubActive(r) { return String(r.subscription_status || '').trim().toLowerCase() === 'active' && !r.subscription_date_canceled && _attrHasAppt(r); }
// Booked online by the customer themselves (per Isaac, Oct 2): source is the
// online booker (PestBooker, or the older Click-To-Buy) AND the sale sits on
// the house account ("RIDD Account - Office") instead of a rep. Those keep the
// booker as their source even when a paid lead exists — an abandoned cart a
// rep then closed has a real rep on it and is NOT one of these.
function _attrKeepBooked() { const A = state._attr; return !A || A.keepBooked !== false; }
function _attrSelfBooked(r) { return /pest ?booker|click[- ]?to[- ]?buy/i.test(String(reportingSourceOf(r) || '')) && /^\s*account,\s*ridd\b|ridd account/i.test(String(r.sold_by || '')); }
function _attrSince() { const A = state._attr; return (A && /^\d{4}-\d{2}-\d{2}$/.test(A.since || '')) ? A.since : new Date().getFullYear() + '-01-01'; }

const _attrDigits = (v) => { const d = String(v == null ? '' : v).replace(/\D/g, ''); return d.length >= 10 ? d.slice(-10) : ''; };
const _attrEmail = (v) => { const e = String(v || '').trim().toLowerCase(); return /@/.test(e) ? e : ''; };
const _attrWord = (v) => String(v || '').trim().toLowerCase().replace(/[^a-z]/g, '');
const _attrZip = (v) => { const m = /(\d{5})/.exec(String(v || '')); return m ? m[1] : ''; };
function _attrDate(v) {
  if (v == null || v === '') return '';
  if (typeof v === 'number' && v > 20000 && v < 80000) { const d = new Date(Math.round((v - 25569) * 86400000)); return d.toISOString().slice(0, 10); }   // Excel serial
  const s = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s); if (m) return m[1] + '-' + m[2].padStart(2, '0') + '-' + m[3].padStart(2, '0');
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s); if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return y + '-' + m[1].padStart(2, '0') + '-' + m[2].padStart(2, '0'); }
  const t = Date.parse(s); return isFinite(t) ? new Date(t).toISOString().slice(0, 10) : '';
}
const _attrAddDays = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };

// Column auto-detect from the header row.
const ATTR_FIELDS = [
  ['date', 'Lead date', /date|created|received|submitted|time/i],
  ['name', 'Full name', /^(full ?name|name|customer|customer name|contact|contact name|lead name|caller|caller name|consumer name|homeowner|homeowner name)$/i],
  ['first', 'First name', /first/i],
  ['last', 'Last name', /last|surname/i],
  ['phone', 'Phone', /phone|mobile|cell|tel|caller ?id|caller ?number|\bani\b/i],
  ['email', 'Email', /e-?mail/i],
  ['zip', 'ZIP', /zip|postal/i],
  ['id', 'Lead ID', /lead ?id|^id$|reference|ref/i],
];
function _attrGuessMap(headers) {
  const map = {};
  for (const [k, , re] of ATTR_FIELDS) { const h = headers.find(x => re.test(String(x || '').trim()) && !Object.values(map).includes(x)); if (h) map[k] = h; }
  return map;
}

// ── persistence (shared across admins) ──
async function _attrLoad() {
  if (state._attr !== undefined) return;
  if (!supabase || (typeof DEMO !== 'undefined' && DEMO)) { state._attr = { files: [] }; return; }
  state._attr = null;
  try {
    const { data, error } = await supabase.storage.from('reporting').download(ATTR_PATH + '?t=' + Date.now());
    if (error || !data) { state._attr = { files: [] }; }
    else {
      const txt = await new Response(data.stream().pipeThrough(new DecompressionStream('gzip'))).text();
      const j = JSON.parse(txt); state._attr = { files: Array.isArray(j.files) ? j.files : [], maps: (j.maps && typeof j.maps === 'object') ? j.maps : {}, reconciledKey: j.reconciledKey || null, reconciledAt: j.reconciledAt || null, reconciledBy: j.reconciledBy || null, useGhl: j.useGhl !== false, activeOnly: j.activeOnly !== false, keepBooked: j.keepBooked !== false, since: j.since || null };
    }
  } catch (e) { state._attr = { files: [] }; }
  mountApp();
}
async function _attrSave() {
  if (!supabase || (typeof DEMO !== 'undefined' && DEMO)) return;
  try {
    const blob = await new Response(new Blob([JSON.stringify({ files: state._attr.files, maps: state._attr.maps || {}, useGhl: state._attr.useGhl !== false, activeOnly: state._attr.activeOnly !== false, keepBooked: state._attr.keepBooked !== false, since: state._attr.since || null, reconciledKey: state._attr.reconciledKey || null, reconciledAt: state._attr.reconciledAt || null, reconciledBy: state._attr.reconciledBy || null, savedAt: new Date().toISOString() })]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
    const { error } = await supabase.storage.from('reporting').upload(ATTR_PATH, blob, { contentType: 'application/gzip', upsert: true });
    if (error) toast('Could not save uploads: ' + error.message, 'error');
  } catch (e) { toast('Could not save uploads: ' + (e.message || e), 'error'); }
}

// ── the CRM side: one index over the reporting snapshot ──
function _attrCrmIndex() {
  const subs = state.reportingSubscriptions || [];
  if (state._attrIdx && state._attrIdx.src === subs) return state._attrIdx;
  const cust = new Map(), byPhone = new Map(), byEmail = new Map(), byNameZip = new Map();
  for (const r of subs) {
    const id = String(r.customer_id != null ? r.customer_id : ''); if (!id) continue;
    let c = cust.get(id);
    if (!c) { c = { id, first: r.first_name || '', last: r.last_name || '', phone: _attrDigits(r.phone), email: _attrEmail(r.email), zip: _attrZip(r.zip_code), office: r.office_name || '', subs: [] }; cust.set(id, c); }
    c.subs.push(r);
    if (c.phone) byPhone.set(c.phone, id);
    if (c.email) byEmail.set(c.email, id);
    if (c.zip && _attrWord(c.last)) byNameZip.set(_attrWord(c.last) + '|' + c.zip, id);
  }
  state._attrIdx = { src: subs, cust, byPhone, byEmail, byNameZip };
  return state._attrIdx;
}
function _attrIsUnset(src) {
  const s = String(src || '').trim();
  if (!s || /^(unspecified|n\/?a|none|unknown|-)$/i.test(s)) return true;
  return (typeof crmSourceIs === 'function') && crmSourceIs('unset', s);
}

// ── reconcile: every lead from every upload, last touch across providers ──
function _attrReconcile() {
  const files = (state._attr && state._attr.files) || [];
  const G = _attrUseGhl() && typeof ghlLeads === 'function' ? ghlLeads() : null;
  const sig = files.map(f => f.id).join(',') + '|' + JSON.stringify(attrPriority()) + '|' + attrKeep().join(',') + '|' + _attrSince() + '|' + (_attrActiveOnly() ? 'act' : 'all') + (_attrKeepBooked() ? 'b' : '') + '|' + (typeof ghlSourceMap === 'function' ? JSON.stringify(ghlSourceMap()) : '') + '|' + (typeof reportingSourceProviderMap === 'function' ? JSON.stringify(reportingSourceProviderMap()) : '');
  const M = state._attrMemo;
  if (M && M.sig === sig && M.G === G && M.subs === state.reportingSubscriptions && M.cfg === state.reportingSourceConfig) return M.out;
  const out = _attrReconcileRun(files, G);
  state._attrMemo = { sig, G, subs: state.reportingSubscriptions, cfg: state.reportingSourceConfig, out };
  return out;
}
function _attrReconcileRun(files, G) {
  const idx = _attrCrmIndex();
  const since = _attrSince();
  const actOnly = _attrActiveOnly(), keepBooked = _attrKeepBooked();
  const KEEP = new Set(attrKeep().map(x => String(x).trim().toLowerCase()));
  const leads = [];
  for (const f of files) for (const l of f.leads || []) leads.push({ ...l, provider: f.provider, fileId: f.id, via: 'file' });
  // GoHighLevel feed: one lead per GHL record on a PAID channel (its own last
  // attribution, else its own source). Skipped when an uploaded report already
  // has that provider + person within 3 days (the report row carries the name).
  let ghlFrom = null, ghlTo = null;
  if (G && G.leads) {
    const paid = (typeof ghlPaidSet === 'function') ? ghlPaidSet() : new Set();
    const lo = _attrAddDays(since, -ATTR_WINDOW_DAYS);
    const have = new Map();   // provider|contact → [dates]
    const note = (prov, k, d) => { if (!k) return; const key = prov + '|' + k; (have.get(key) || have.set(key, []).get(key)).push(d); };
    for (const l of leads) { note(l.provider, _attrDigits(l.phone), l.date); note(l.provider, _attrEmail(l.email), l.date); }
    const near = (prov, k, d) => { if (!k) return false; const ds = have.get(prov + '|' + k); return !!ds && ds.some(x => x && Math.abs(Date.parse(x) - Date.parse(d)) <= 3 * 86400000); };
    // Opportunities first: each is one lead with its OWN source and time, so a
    // second provider reaching an existing contact is seen (the contact row
    // only ever carries the source that created it).
    const lab = (state._ghl && state._ghl.labels) || [];
    for (const o of ((state._ghl && state._ghl.opps) || [])) {
      if (!o[0] || o[0] < lo) continue;
      const prov = o[1] >= 0 ? ghlProviderOf(lab[o[1]]) : null;
      if (!prov || !paid.has(prov)) continue;
      if (near(prov, o[2], o[0]) || near(prov, o[3], o[0])) continue;
      leads.push({ date: o[0], t: o[4] || '', name: '', first: '', last: '', phone: o[2] || '', email: o[3] || '', zip: '', leadId: '', provider: prov, fileId: 'ghl', via: 'ghl', inGhl: true });
      note(prov, o[2], o[0]); note(prov, o[3], o[0]);
    }
    for (const g of G.leads) {
      if (!g.d || g.d < lo) continue;
      if (!ghlFrom || g.d < ghlFrom) ghlFrom = g.d; if (!ghlTo || g.d > ghlTo) ghlTo = g.d;
      const prov = g.how === 'earlier paid touch' ? g.own : g.prov;
      if (!prov || !paid.has(prov)) continue;
      if (near(prov, g.p, g.d) || near(prov, g.e, g.d)) continue;
      leads.push({ date: g.d, t: g.t || '', name: '', first: '', last: '', phone: g.p || '', email: g.e || '', zip: '', leadId: '', provider: prov, fileId: 'ghl', via: 'ghl', inGhl: true });
      note(prov, g.p, g.d); note(prov, g.e, g.d);
    }
  }
  // 1. Match each lead to a customer: phone, then email, then last name + ZIP.
  for (const l of leads) {
    const p = _attrDigits(l.phone), e = _attrEmail(l.email);
    const last = _attrWord(l.last || (String(l.name || '').trim().split(/\s+/).slice(-1)[0] || '')), zip = _attrZip(l.zip);
    let id = null, how = null;
    if (p && idx.byPhone.has(p)) { id = idx.byPhone.get(p); how = 'phone'; }
    else if (e && idx.byEmail.has(e)) { id = idx.byEmail.get(e); how = 'email'; }
    else if (last && zip && idx.byNameZip.has(last + '|' + zip)) { id = idx.byNameZip.get(last + '|' + zip); how = 'name + ZIP'; }
    l.custId = id; l.matchHow = how;
  }
  // 2. The sale each lead points at: the first new (non-renewal) subscription
  //    sold from 3 days before the lead to ATTR_WINDOW_DAYS after it.
  const saleOf = (l) => {
    const c = idx.cust.get(l.custId); if (!c || !l.date) return null;
    const lo = _attrAddDays(l.date, -1), hi = _attrAddDays(l.date, ATTR_WINDOW_DAYS);
    const cands = c.subs.filter(r => { const sd = String(r.sold_date || '').slice(0, 10); return sd >= lo && sd <= hi && (!actOnly || _attrSubActive(r)) && (typeof reportingSourceClass !== 'function' || reportingSourceClass(reportingSourceOf(r)) !== 'renewal'); })
      .sort((a, b) => String(a.sold_date).localeCompare(String(b.sold_date)));
    return cands[0] || null;
  };
  for (const l of leads) l.sale = l.custId ? saleOf(l) : null;
  // 3. Last touch per sale: the latest lead on or before the sale date wins.
  const bySale = new Map();
  for (const l of leads) if (l.sale) { const k = String(l.sale.subscription_id || (l.custId + '|' + l.sale.sold_date)); (bySale.get(k) || bySale.set(k, []).get(k)).push(l); }
  for (const [, ls] of bySale) {
    const sd = String(ls[0].sale.sold_date).slice(0, 10);
    const eligible = ls.filter(x => x.date <= _attrAddDays(sd, 1));
    const pool = (eligible.length ? eligible : ls).slice();
    pool.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.t || '').localeCompare(String(a.t || '')) || String(a.provider).localeCompare(String(b.provider)));
    let win = pool[0], rule = 'last touch';
    // Priority window (ElectGen, 7 days): a lead from that provider inside its
    // window before the sale takes the sale, whatever touched after it.
    const PR = attrPriority();
    const pri = pool.filter(x => PR[x.provider] && x.date >= _attrAddDays(sd, -Number(PR[x.provider])) && x.date <= _attrAddDays(sd, 1));
    if (pri.length && pri[0].provider !== win.provider) { win = pri[0]; rule = win.provider + ' ' + PR[win.provider] + '-day window'; }
    else if (pri.length) rule = win.provider + ' ' + PR[win.provider] + '-day window';
    const touches = [...new Set(ls.map(y => y.provider))];
    // Latest lead per channel before the sale — the dates shown beside "Current source" and "Should be".
    const lastBy = {}; for (const x of pool) if (x.date && (!lastBy[x.provider] || x.date > lastBy[x.provider])) lastBy[x.provider] = x.date;
    for (const x of ls) { x.winner = win.provider; x.winDate = win.date; x.lastBy = lastBy; x.isWinner = x.provider === win.provider; x.touches = touches; x.rule = rule; }
  }
  // 4. Classify.
  for (const l of leads) {
    const c = l.custId ? idx.cust.get(l.custId) : null;
    if (!c) { l.status = 'nomatch'; continue; }
    if (!l.name) l.name = [c.first, c.last].filter(Boolean).join(' ');   // GoHighLevel leads carry no name — show the customer's
    if (!l.sale) {
      const before = c.subs.some(r => String(r.sold_date || '') < String(l.date || '9999'));
      l.status = before ? 'existing' : 'nosale'; continue;
    }
    const cur = reportingSourceOf(l.sale);
    l.currentSource = cur;
    // Door to Door in the CRM stays Door to Door (per Isaac): mostly current
    // D2D customers who found a paid channel to ask a question. Kept separate
    // — never a fix, never a provider close.
    if (typeof crmSourceIs === 'function' && crmSourceIs('d2d', cur)) { l.status = 'd2d'; continue; }
    if (KEEP.has(String(cur || '').trim().toLowerCase())) { l.status = 'kept'; continue; }
    if (keepBooked && _attrSelfBooked(l.sale)) { l.status = 'booked'; continue; }
    if (!l.isWinner) { l.status = 'otherwon'; continue; }
    const curProv = (typeof reportingProviderOf === 'function') ? reportingProviderOf(cur) : cur;   // "#49 FB" in the CRM = Facebook
    l.status = (cur === l.provider || curProv === l.provider) ? 'correct' : _attrIsUnset(cur) ? 'nosource' : 'missourced';
  }
  // GoHighLevel check (per Isaac): every provider lead SHOULD be in GHL —
  // flag the ones that never made it (null = GHL not loaded yet).
  if (typeof ghlHasContact === 'function') for (const l of leads) if (l.via !== 'ghl') l.inGhl = ghlHasContact(l.phone, l.email);
  // One credited lead per provider per sale (a provider sending the same person twice counts once).
  const seen = new Set();
  for (const l of leads) {
    if (!l.sale || !l.isWinner) continue;
    const k = l.provider + '|' + (l.sale.subscription_id || l.custId);
    if (seen.has(k)) l.dupe = true; else seen.add(k);
  }
  // 5. LAST PAID TOUCH, ELSE ORGANIC (per Isaac, Sep 30). Every uploaded
  //    provider is a paid channel. A new office-staff sale inside the dates
  //    the uploads cover that NO paid lead points at is Organic: flag it
  //    when FieldRoutes has it on a paid provider (that provider's report
  //    doesn't have them) or on no source at all.
  const credited = new Set(); for (const [k] of bySale) credited.add(k);
  const cover = new Map();   // provider → [from, to + window]
  for (const f of files) { if (!f.from || !f.to) continue; const c = cover.get(f.provider) || [f.from, f.to]; cover.set(f.provider, [f.from < c[0] ? f.from : c[0], f.to > c[1] ? f.to : c[1]]); }
  // GoHighLevel covers EVERY paid channel for the dates it has been synced.
  if (ghlFrom && ghlTo && typeof ghlPaidSet === 'function') for (const pv of ghlPaidSet()) { const c = cover.get(pv) || [ghlFrom, ghlTo]; cover.set(pv, [ghlFrom < c[0] ? ghlFrom : c[0], ghlTo > c[1] ? ghlTo : c[1]]); }
  const allFrom = [...cover.values()].map(c => c[0]).sort()[0], allTo = [...cover.values()].map(c => c[1]).sort().slice(-1)[0];
  const provOfSrc = (x) => (typeof reportingProviderOf === 'function' ? reportingProviderOf(x) : x) || x;
  const organic = [];
  if (allFrom) for (const r of state.reportingSubscriptions || []) {
    const sd = String(r.sold_date || '').slice(0, 10); if (!sd || sd < since) continue;
    if (actOnly && !_attrSubActive(r)) continue;
    if (KEEP.has(String(reportingSourceOf(r) || '').trim().toLowerCase())) continue;
    const k = String(r.subscription_id || (r.customer_id + '|' + r.sold_date)); if (credited.has(k)) continue;
    if (typeof reportingIsOfficeStaff === 'function' && !reportingIsOfficeStaff(r)) continue;
    const src = reportingSourceOf(r);
    if (typeof reportingSourceClass === 'function' && reportingSourceClass(src) !== 'new') continue;
    const cv = cover.get(src) || cover.get(provOfSrc(src));
    const inPaid = cv && sd >= cv[0] && sd <= _attrAddDays(cv[1], ATTR_WINDOW_DAYS);
    const inAny = sd >= allFrom && sd <= _attrAddDays(allTo, ATTR_WINDOW_DAYS);
    if (inPaid || (inAny && _attrIsUnset(src))) organic.push({ provider: ATTR_ORGANIC, date: '', name: [r.first_name, r.last_name].filter(Boolean).join(' '), custId: String(r.customer_id), sale: r, isWinner: true, currentSource: src,
      status: 'toorganic', why: inPaid ? 'no ' + src + ' lead found for them' : 'no paid lead' });
  }
  // Leads older than the "sales since" date that never became a sale in range are noise — drop them.
  return leads.filter(l => l.sale ? String(l.sale.sold_date).slice(0, 10) >= since : (l.date || '') >= since).concat(organic);
}
const ATTR_ORGANIC = 'Organic';
const ATTR_STATUS = {
  correct:    ['Sourced correctly', 'var(--ok)'],
  nosource:   ['No source — set it', '#DC2626'],
  missourced: ['Mis-sourced — change it', '#DC2626'],
  otherwon:   ['Credit to another provider (last touch)', '#B45309'],
  existing:   ['Already a customer', 'var(--text-muted)'],
  nosale:     ['In CRM, no new sale', 'var(--text-muted)'],
  nomatch:    ['Not in CRM', 'var(--text-muted)'],
  toorganic:  ['No paid lead — set to Organic', '#DC2626'],
  kept:       ['Protected source — kept', 'var(--text-muted)'],
  booked:     ['Booked online by the customer — kept', 'var(--text-muted)'],
  d2d:        ['Door to Door in CRM — kept', 'var(--text-muted)'],
  noghl:      ['Not in GoHighLevel', '#B45309'],
};
// A fix = a lead proves the source, OR a paid source with no lead anywhere in GoHighLevel / the reports
// (per Isaac: reps ask on inbound calls and pick a channel — with no lead behind it, it is Organic).
const _attrIsFix = (l) => (l.status === 'nosource' || l.status === 'missourced' || l.status === 'toorganic') && !l.dupe;
const _attrHasShould = (l) => _attrIsFix(l) || l.status === 'toorganic';
// Channel + lead date this row points at: the winning channel and the date of its lead when there is a sale, else the lead itself.
const _attrShould = (l) => l.status === 'toorganic' ? [ATTR_ORGANIC, ''] : (l.sale && l.winner) ? [l.winner, l.winDate || ''] : [l.provider, l.date || ''];
// When the sale's CURRENT FieldRoutes source last sent a lead before the sale ('' = that channel never did).
const _attrCurDate = (l) => { if (!l.sale || !l.lastBy) return ''; const cur = reportingSourceOf(l.sale); return l.lastBy[cur] || l.lastBy[(typeof reportingProviderOf === 'function' && reportingProviderOf(cur)) || cur] || ''; };
// Leads / closes / fixes for a set of rows (closes = sales credited by last paid touch, once per sale).
// ── Paper trail for one row (per Isaac): EVERYTHING we hold for that person,
// oldest first — every GoHighLevel record (whatever its source), every
// uploaded report row, and every FieldRoutes sale — so the credit can be
// checked by eye. Matched on the lead's and the customer's phone / email.
function _attrTrail(l) {
  const c = l.custId ? _attrCrmIndex().cust.get(String(l.custId)) : null;
  const phones = new Set([_attrDigits(l.phone), c && c.phone].filter(Boolean));
  const emails = new Set([_attrEmail(l.email), c && c.email].filter(Boolean));
  const ev = [];
  const G = state._ghl;
  if (G && G.rows && _attrUseGhl()) {
    const lab = G.labels || [], nm = (i) => i >= 0 ? lab[i] : '';
    const pv = (x) => { if (!x) return ''; const p = ghlProviderOf(x); return p === GHL_NOT_LEAD ? 'not a lead' : (p || x); };
    for (const r of G.rows) {
      if (!((r[4] && phones.has(r[4])) || (r[5] && emails.has(r[5])))) continue;
      const src = nm(r[1]), fa = nm(r[2]), la = nm(r[3]);
      const ch = pv(la) && pv(la) !== 'not a lead' && pv(la) !== 'Organic' ? pv(la) : (pv(src) || pv(la) || pv(fa) || 'no source');
      ev.push({ d: r[0], t: r[7] || '', kind: 'lead', ch, from: 'GoHighLevel contact', note: ['source: ' + (src || 'blank'), fa ? 'first attribution: ' + fa : '', la ? 'last attribution: ' + la : ''].filter(Boolean).join(' · ') });
    }
  }
  if (G && G.opps && _attrUseGhl()) {
    const lab = G.labels || [];
    for (const o of G.opps) {
      if (!((o[2] && phones.has(o[2])) || (o[3] && emails.has(o[3])))) continue;
      const src = o[1] >= 0 ? lab[o[1]] : ''; const p = src ? ghlProviderOf(src) : '';
      ev.push({ d: o[0], t: o[4] || '', kind: 'lead', ch: p === GHL_NOT_LEAD ? 'not a lead' : (p || 'no source'), from: 'GoHighLevel opportunity', note: 'source: ' + (src || 'blank') + (o[5] ? ' · ' + o[5] : '') + (o[4] ? ' · ' + o[4] + ' UTC' : '') });
    }
  }
  for (const f of ((state._attr && state._attr.files) || [])) for (const x of f.leads || []) {
    const p = _attrDigits(x.phone), e = _attrEmail(x.email);
    if ((p && phones.has(p)) || (e && emails.has(e))) ev.push({ d: x.date || '', kind: 'lead', ch: f.provider, from: 'Report', note: f.fileName || '' });
  }
  if (c) for (const r of c.subs) {
    const sd = String(r.sold_date || '').slice(0, 10); if (!sd) continue;
    const mine = l.sale && String(r.subscription_id) === String(l.sale.subscription_id);
    ev.push({ d: sd, kind: 'sale', mine, ch: 'SALE', from: 'FieldRoutes', note: 'source entered by rep: ' + reportingSourceOf(r) + ' (not a lead) · ' + (r.subscription || 'subscription') + ' #' + (r.subscription_id || '?') + ' · ' + (r.subscription_status || 'status ?') + (r.sold_by ? ' · ' + r.sold_by : '') });
  }
  const paid = (typeof ghlPaidSet === 'function') ? ghlPaidSet() : new Set();
  ev.sort((a, b) => String(a.d).localeCompare(String(b.d)) || (a.kind === 'sale' ? 1 : b.kind === 'sale' ? -1 : String(a.t || '').localeCompare(String(b.t || ''))));
  let credited = false;
  for (const e of ev) {
    e.paid = e.kind === 'lead' && paid.has(e.ch);
    if (e.kind === 'lead' && !credited && l.sale && l.winner && e.ch === l.winner && e.d === l.winDate) { e.win = true; credited = true; }
  }
  return ev;
}
function _attrTrailNode(l, cols) {
  const muted = { color: 'var(--text-muted)' };
  const ev = _attrTrail(l);
  const cell = (v, st) => el('td', { class: 'px-2 py-1 whitespace-nowrap', style: st || {} }, v || '—');
  const verdict = l.sale && l.winner ? 'Credit: ' + l.winner + (l.winDate ? ' (lead ' + l.winDate + ')' : '') + ' · rule: ' + (l.rule || 'last touch') + ' · FieldRoutes currently says ' + reportingSourceOf(l.sale)
    : l.status === 'toorganic' ? 'No paid lead found before this sale — Organic' : 'No sale tied to this lead';
  return el('tr', { 'data-attr-trail': '1' }, el('td', { colspan: String(cols), class: 'px-4 py-3', style: { background: 'var(--border-2)' } },
    el('div', { class: 'text-[11px] font-bold mb-1' }, 'Paper trail · ' + ev.length + ' record' + (ev.length === 1 ? '' : 's')),
    el('div', { class: 'text-[11px] mb-2', style: muted }, verdict),
    (l.sale && l.winner && !ev.some(e => e.kind === 'lead' && (e.ch === reportingSourceOf(l.sale) || (typeof reportingProviderOf === 'function' && e.ch === reportingProviderOf(reportingSourceOf(l.sale)))))) ? el('div', { class: 'text-[11px] mb-2', style: { color: '#B45309', fontWeight: '600' } }, 'No ' + reportingSourceOf(l.sale) + ' lead on file for this person — that source was only typed on the sale.') : null,
    ev.length ? el('table', { class: 'text-[11px]' },
      el('thead', {}, el('tr', {}, ...['Date', 'Lead channel', 'From', 'Detail', ''].map(h => el('th', { class: 'px-2 py-1 text-left text-[9px] uppercase tracking-wider font-semibold', style: muted }, h)))),
      el('tbody', {}, ...ev.map(e => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        cell(e.d), cell(e.ch, { fontWeight: e.kind === 'sale' || e.paid ? '700' : '400', color: e.kind === 'sale' ? 'var(--accent)' : e.paid ? 'var(--text)' : 'var(--text-muted)' }),
        cell(e.from, muted), cell(e.note, e.kind === 'sale' ? { fontWeight: '600' } : muted),
        cell(e.win ? '← last paid lead before the sale — gets the credit' : e.kind === 'sale' && e.mine ? '← this sale' : e.kind === 'lead' && !e.paid ? 'not a paid channel' : '', e.win ? { color: 'var(--ok)', fontWeight: '700' } : muted))))) :
      el('div', { class: 'text-[11px]', style: muted }, 'Nothing on file for this phone / email.')));
}
function _attrStats(rows) {
  const leadRows = rows.filter(l => l.status !== 'toorganic');
  const closes = leadRows.filter(l => l.sale && l.isWinner && !l.dupe && l.status !== 'd2d' && l.status !== 'kept' && l.status !== 'booked');
  return { leads: leadRows.length, closes: closes.length, closeValue: closes.reduce((t, l) => t + (Number(l.sale.subscription_contract_value) || 0), 0), fixes: rows.filter(_attrIsFix).length };
}

// ── upload (one file or a batch) ──
// Batch (per Isaac, Sep 30): pick several provider reports at once. Each
// file's provider is guessed from its file name (a source name inside it,
// longest match wins) or falls back to the provider picked in the bar; the
// confirm step shows every file with its provider + columns, and "Add all"
// saves them together so last touch and the Organic check run across the
// full set in one pass.
function _attrGuessProvider(fileName, sources) {
  const f = String(fileName || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  let best = '';
  for (const s of sources || []) { const k = String(s).toLowerCase().replace(/[^a-z0-9]/g, ''); if (k.length >= 3 && f.includes(k) && k.length > best.replace(/[^a-z0-9]/gi, '').length) best = s; }
  return best;
}
async function _attrUpload(files, sources) {
  const list = Array.from(files || []); if (!list.length) return;
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  state._attrPending = state._attrPending || [];
  for (const file of list) {
    try {
      // EVERY tab of a workbook is its own upload (per Isaac, Sep 30): DoLead's
      // disposition report has a Calls tab and a Forms tab with different
      // column names, so each tab gets its own column mapping.
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      const provider = _attrGuessProvider(file.name, sources) || state._attrUpProv || '';
      let any = false;
      for (const sheet of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '', raw: true });
        if (!rows.length) continue;
        any = true;
        const headers = Object.keys(rows[0]);
        const multi = wb.SheetNames.length > 1;
        // A mapping confirmed before for this provider + these same columns is reused.
        const saved = provider && state._attr && state._attr.maps ? state._attr.maps[_attrMapKey(provider, headers)] : null;
        state._attrPending.push({ key: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), provider, fileName: multi ? file.name + ' · ' + sheet : file.name, sheet, headers, rows,
          map: saved ? Object.fromEntries(Object.entries(saved).filter(([, h]) => headers.includes(h))) : _attrGuessMap(headers), remembered: !!saved });
      }
      if (!any) toast('No rows found in ' + file.name, 'error');
    } catch (e) { toast('Could not read ' + file.name + ': ' + (e.message || e), 'error'); }
  }
  mountApp();
}
// Column mappings are remembered per provider + set of column names, so the
// same report (or the same DoLead tab) maps itself next time.
function _attrMapKey(provider, headers) { return String(provider) + '|' + [...headers].map(h => String(h).trim().toLowerCase()).sort().join('\u0001'); }
function _attrPendingProblem(P) {
  if (!P.provider) return 'pick the provider';
  if (!P.map.date) return 'map the lead date column';
  if (!P.map.phone && !P.map.email && !P.map.last && !P.map.name) return 'map phone, email or name';
  return null;
}
function _attrCommitPending() {
  const list = state._attrPending || []; if (!list.length) return;
  const bad = list.map(P => [P, _attrPendingProblem(P)]).find(([, p]) => p);
  if (bad) { toast(bad[0].fileName + ': ' + bad[1], 'error'); return; }
  const added = [];
  for (const P of list) {
    const g = (r, k) => P.map[k] ? r[P.map[k]] : '';
    const leads = P.rows.map(r => {
      const name = String(g(r, 'name') || [g(r, 'first'), g(r, 'last')].filter(Boolean).join(' ')).trim();
      return { date: _attrDate(g(r, 'date')), name, first: String(g(r, 'first') || ''), last: String(g(r, 'last') || ''), phone: String(g(r, 'phone') || ''), email: String(g(r, 'email') || ''), zip: String(g(r, 'zip') || ''), leadId: String(g(r, 'id') || '') };
    }).filter(l => l.phone || l.email || l.name);
    const dates = leads.map(l => l.date).filter(Boolean).sort();
    const f = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), provider: P.provider, fileName: P.fileName, uploadedAt: new Date().toISOString(), uploadedBy: state.profile && state.profile.full_name, from: dates[0] || null, to: dates[dates.length - 1] || null, leads };
    state._attr.files.push(f); added.push(f);
    state._attr.maps = state._attr.maps || {};
    state._attr.maps[_attrMapKey(P.provider, P.headers)] = { ...P.map };
  }
  state._attrPending = null;
  // No reconciliation yet (per Isaac, Sep 30): add every report first, then
  // press "Reconcile all reports" so last touch runs across the full set.
  _attrSave();
  toast(added.length + ' report' + (added.length === 1 ? '' : 's') + ' added (' + added.reduce((t, f) => t + f.leads.length, 0).toLocaleString() + ' leads) — press Reconcile when every report is in', 'success'); mountApp();
}
const _attrFilesKey = (files) => (files || []).map(f => f.id).sort().join(',') + (_attrUseGhl() ? '|ghl' : '');
function _attrRunReconcile() {
  const A = state._attr; if (!A) return;
  state._attrMemo = null;
  A.reconciledKey = _attrFilesKey(A.files); A.reconciledAt = new Date().toISOString(); A.reconciledBy = state.profile && state.profile.full_name;
  state._attrStatus = 'fix';
  _attrSave();
  const rec = _attrReconcile(); const st = _attrStats(rec);
  toast('Reconciled ' + (_attrUseGhl() ? 'GoHighLevel' + (A.files.length ? ' + ' : '') : '') + (A.files.length ? A.files.length + ' report' + (A.files.length === 1 ? '' : 's') : '') + ': ' + st.leads.toLocaleString() + ' leads · ' + st.closes.toLocaleString() + ' closes · ' + st.fixes.toLocaleString() + ' fixes', 'success');
  mountApp();
}

async function _attrExport(rows) {
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library', 'error'); return; }
  const H = ['Customer #', 'Customer', 'Subscription #', 'Service', 'Sold', 'Current source', 'Current source last lead', 'Should be', 'Should-be lead date', 'Lead provider', 'Lead date', 'Lead name', 'Lead phone', 'Lead email', 'Matched by', 'All providers touched', 'Lead from', 'Rule', 'Status'];
  const data = rows.map(l => [l.custId || '', l.sale ? [l.sale.first_name, l.sale.last_name].filter(Boolean).join(' ') : '', l.sale ? l.sale.subscription_id : '', l.sale ? l.sale.subscription : '', l.sale ? String(l.sale.sold_date).slice(0, 10) : '', l.sale ? reportingSourceOf(l.sale) : '', _attrCurDate(l), _attrHasShould(l) ? (l.status === 'toorganic' ? ATTR_ORGANIC : l.provider) : l.status === 'otherwon' ? l.winner : '', (_attrHasShould(l) || l.status === 'otherwon') ? _attrShould(l)[1] : '', l.provider, l.date, l.name, l.phone, l.email, l.matchHow || '', (l.touches || [l.provider]).join(', '), l.via === 'ghl' ? 'GoHighLevel' : l.via === 'file' ? 'Report' : '', (l.sale && l.isWinner && l.rule) || '', (ATTR_STATUS[l.status] || [l.status])[0]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...data]), 'Lead reconciliation');
  XLSX.writeFile(wb, 'RIDD-lead-reconciliation-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

// ── the view ──
function mktgAttributionView() {
  if (typeof ghlLoadLeads === 'function') ghlLoadLeads();
  _attrLoad();
  const A = state._attr;
  const muted = { color: 'var(--text-muted)' };
  if (A === undefined || A === null) return el('div', { class: 'card p-6 text-[11px] text-center', style: muted }, 'Loading lead uploads…');
  if (!(state.reportingSubscriptions || []).length) return el('div', { class: 'card p-6 text-[11px] text-center', style: muted }, 'Waiting for the CRM snapshot to load…');
  const allSrc = [...new Set((state.reportingSubscriptions || []).map(r => String(reportingSourceOf(r) || '').trim()))].filter(x => x && !_attrIsUnset(x)).sort();
  const sources = [...new Set([...(state.reportingSourceConfig || []).map(c => c.source), ...(state.reportingSubscriptions || []).map(r => reportingSourceOf(r))])]
    .filter(s => s && !_attrIsUnset(s) && (typeof reportingSourceClass !== 'function' || reportingSourceClass(s) === 'new') && !(typeof crmSourceIs === 'function' && crmSourceIs('d2d', s))).sort();
  const btn = 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold';
  const primary = { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' };
  // Upload bar
  const provSel = el('select', { class: btn, style: { borderColor: 'var(--border-2)', background: 'var(--card)' }, onchange: (e) => { state._attrUpProv = e.target.value; } },
    el('option', { value: '' }, 'Default provider (else from file name)…'), ...sources.map(s => el('option', { value: s, selected: state._attrUpProv === s }, s)));
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.csv,.xlsx,.xls', style: { display: 'none' }, onchange: (e) => { const fs = e.target.files; if (fs && fs.length) _attrUpload(fs, sources); e.target.value = ''; } });
  const upload = el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Backup · upload lead reports'), provSel, fileIn,
    el('button', { class: btn, style: primary, onclick: () => fileIn.click() }, '↑ Choose files (one or many)'),
    el('span', { class: 'text-[10px]', style: muted }, 'Optional — for a provider whose leads didn’t all reach GoHighLevel. Duplicates of GoHighLevel leads are merged · a lead counts toward a sale made within ' + ATTR_WINDOW_DAYS + ' days after it · matched to FieldRoutes by phone, then email, then last name + ZIP'));
  // Confirm step — every file waiting to be added, each with its provider + columns.
  const PL = state._attrPending || [];
  const selStyle = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', textTransform: 'none', letterSpacing: 'normal' };
  const mapping = PL.length ? el('div', { class: 'card p-4 flex flex-col gap-3', style: { borderColor: 'var(--accent)' } },
    el('div', { class: 'flex items-center gap-2 flex-wrap' },
      el('div', { class: 'text-sm font-bold' }, 'Confirm ' + PL.length + ' file' + (PL.length === 1 ? '' : 's') + ' · ' + PL.reduce((t, P) => t + P.rows.length, 0).toLocaleString() + ' rows'),
      el('button', { class: btn + ' ml-auto', style: primary, onclick: () => _attrCommitPending() }, 'Add all'),
      el('button', { class: btn, style: { borderColor: 'var(--border-2)' }, onclick: () => { state._attrPending = null; mountApp(); } }, 'Cancel all')),
    ...PL.map(P => {
      const prob = _attrPendingProblem(P);
      return el('div', { class: 'border rounded-lg p-3 flex flex-col gap-2', style: { borderColor: prob ? '#DC2626' : 'var(--border)' } },
        el('div', { class: 'flex items-center gap-2 flex-wrap' },
          el('span', { class: 'text-[12px] font-bold' }, P.fileName), el('span', { class: 'text-[11px]', style: muted }, P.rows.length.toLocaleString() + ' rows →'),
          el('select', { class: btn, style: { borderColor: P.provider ? 'var(--border-2)' : '#DC2626', background: 'var(--card)' }, onchange: (e) => { P.provider = e.target.value; const sv = P.provider && state._attr && state._attr.maps ? state._attr.maps[_attrMapKey(P.provider, P.headers)] : null; if (sv) { P.map = Object.fromEntries(Object.entries(sv).filter(([, h]) => P.headers.includes(h))); P.remembered = true; } mountApp(); } },
            el('option', { value: '' }, 'Provider…'), ...sources.map(x => el('option', { value: x, selected: P.provider === x }, x))),
          prob ? el('span', { class: 'text-[11px] font-semibold', style: { color: '#DC2626' } }, 'Needs: ' + prob) : el('span', { class: 'text-[11px]', style: { color: 'var(--ok)' } }, 'Ready' + (P.remembered ? ' · columns remembered from last time' : '')),
          el('button', { class: 'ml-auto text-[11px] font-semibold', style: { color: '#A9441F' }, onclick: () => { state._attrPending = PL.filter(x => x !== P); if (!state._attrPending.length) state._attrPending = null; mountApp(); } }, 'Remove')),
        el('div', { class: 'grid gap-2', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
          ...ATTR_FIELDS.map(([k, label]) => el('label', { class: 'flex flex-col gap-1 text-[9px] uppercase tracking-wider font-semibold', style: muted }, label,
            el('select', { class: 'rounded-lg border px-2 py-1 text-[11px]', style: selStyle, onchange: (e) => { if (e.target.value) P.map[k] = e.target.value; else delete P.map[k]; mountApp(); } },
              el('option', { value: '' }, '— none —'), ...P.headers.map(h => el('option', { value: h, selected: P.map[k] === h }, h)))))),
        el('div', { class: 'text-[10px]', style: muted }, 'First row: ' + ATTR_FIELDS.filter(([k]) => P.map[k]).map(([k, lbl]) => lbl + ' = ' + (k === 'date' ? (_attrDate(P.rows[0][P.map[k]]) || '⚠ unreadable date') : String(P.rows[0][P.map[k]] ?? ''))).join(' · ')));
    })) : null;
  // ── Lead feeds + rules ──
  const GL = (typeof ghlLeads === 'function') ? ghlLeads() : null;
  const Gst = state._ghl;
  const useGhl = _attrUseGhl();
  const ghlReady = !!(GL && GL.leads && GL.leads.length);
  const hasFeed = !!A.files.length || (useGhl && ghlReady);
  const PR = attrPriority();
  const numIn = (v, fn) => el('input', { type: 'number', min: '1', max: '90', value: String(v), class: 'rounded-lg border px-2 py-0.5 text-[11px] tabular-nums', style: { width: '56px', borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => fn(e.target.value) });
  const feedCard = el('div', { class: 'card p-4 flex flex-col gap-3' },
    el('div', { class: 'flex items-center gap-3 flex-wrap' },
      el('div', { class: 'text-sm font-bold' }, 'Lead feeds'),
      el('span', { class: 'text-[11px]', style: muted }, 'Last touch: the last paid lead channel on or before the sale gets the sale. No paid lead = Organic.')),
    el('div', { class: 'flex items-center gap-3 flex-wrap text-[11px]' },
      el('label', { class: 'inline-flex items-center gap-2 font-semibold cursor-pointer' },
        (() => { const c = el('input', { type: 'checkbox', style: { accentColor: 'var(--accent)' }, onchange: (e) => { A.useGhl = e.target.checked; state._attrMemo = null; _attrSave(); mountApp(); } }); c.checked = useGhl; return c; })(),
        'GoHighLevel (main feed)'),
      el('span', { style: Gst && (Gst.missing || Gst.error) ? { color: '#DC2626' } : muted },
        Gst == null ? 'loading…' : Gst.missing ? 'no GoHighLevel sync file yet — run the sync in Settings → Marketing & lead sources' : Gst.error ? 'could not load: ' + Gst.error
          : ghlReady ? GL.leads.length.toLocaleString() + ' leads · synced ' + (Gst.at ? new Date(Gst.at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '?') + (Gst.backfillDone ? '' : ' · history still backfilling') : 'no leads in the sync file'),
      el('label', { class: 'ml-auto inline-flex items-center gap-2 font-semibold cursor-pointer', title: 'Only reconcile sales whose subscription is still Active in FieldRoutes (not cancelled or frozen) AND has at least a scheduled or completed appointment.' },
        (() => { const c = el('input', { type: 'checkbox', style: { accentColor: 'var(--accent)' }, onchange: (e) => { A.activeOnly = e.target.checked; state._attrMemo = null; _attrSave(); mountApp(); } }); c.checked = _attrActiveOnly(); return c; })(),
        'Active with an appointment only'),
      el('label', { class: 'inline-flex items-center gap-2 font-semibold cursor-pointer', title: 'A sale the customer booked themselves online (source PestBooker / Click-To-Buy, on the RIDD house account with no rep) keeps that source even when a paid lead exists. An abandoned cart a rep closed is not one of these.' },
        (() => { const c = el('input', { type: 'checkbox', style: { accentColor: 'var(--accent)' }, onchange: (e) => { A.keepBooked = e.target.checked; state._attrMemo = null; _attrSave(); mountApp(); } }); c.checked = _attrKeepBooked(); return c; })(),
        'Online bookings keep PestBooker'),
      el('span', { class: 'inline-flex items-center gap-2' }, el('span', { style: muted }, 'Sales sold since'),
        el('input', { type: 'date', value: _attrSince(), class: 'rounded-lg border px-2 py-0.5 text-[11px]', style: { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)' }, onchange: (e) => { A.since = e.target.value || null; state._attrMemo = null; _attrSave(); mountApp(); } }))),
    el('div', { class: 'flex items-center gap-2 flex-wrap text-[11px]' },
      el('span', { class: 'font-semibold', title: 'A provider paid per job: it gets the sale when it sent a lead within this many days before the sale, even if another channel touched after.' }, 'Priority window'),
      ...Object.keys(PR).sort().map(pv => el('span', { class: 'inline-flex items-center gap-1 rounded-full px-2 py-0.5', style: { background: 'rgba(223,100,58,.10)' } },
        el('span', { class: 'font-semibold' }, pv), numIn(PR[pv], (v) => { setAttrPriority(pv, v); mountApp(); }), el('span', { style: muted }, 'days'),
        el('button', { class: 'text-[13px] leading-none', 'aria-label': 'Remove ' + pv, style: { color: 'var(--text-muted)', minWidth: '24px', minHeight: '24px' }, onclick: () => { setAttrPriority(pv, null); mountApp(); } }, '×'))),
      el('select', { class: btn, style: { borderColor: 'var(--border-2)', background: 'var(--card)' }, onchange: (e) => { if (e.target.value) { setAttrPriority(e.target.value, 7); mountApp(); } } },
        el('option', { value: '' }, '+ provider'), ...sources.filter(x => !(x in PR)).map(x => el('option', { value: x }, x))),
      el('span', { style: muted }, 'wins the sale when its lead came within the window before the sale, even if another channel touched after.')),
    el('div', { class: 'flex items-center gap-2 flex-wrap text-[11px]' },
      el('span', { class: 'font-semibold', title: 'A sale with one of these FieldRoutes sources keeps it, even when a paid lead exists. Door to Door is always kept.' }, 'Never overwrite'),
      el('span', { class: 'rounded-full px-2 py-0.5 font-semibold', style: { background: 'var(--border-2)' } }, 'Door to Door'),
      ...attrKeep().map(k => el('span', { class: 'inline-flex items-center gap-1 rounded-full px-2 py-0.5', style: { background: 'var(--border-2)' } },
        el('span', { class: 'font-semibold' }, k),
        el('button', { class: 'text-[13px] leading-none', 'aria-label': 'Remove ' + k, style: { color: 'var(--text-muted)', minWidth: '24px', minHeight: '24px' }, onclick: () => { setAttrKeep(k, false); mountApp(); } }, '×'))),
      el('select', { class: btn, style: { borderColor: 'var(--border-2)', background: 'var(--card)' }, onchange: (e) => { if (e.target.value) { setAttrKeep(e.target.value, true); mountApp(); } } },
        el('option', { value: '' }, '+ source'), ...allSrc.filter(x => !attrKeep().includes(x)).map(x => el('option', { value: x }, x))),
      el('span', { style: muted }, 'these sources stay as they are in FieldRoutes.')));
  const reconciled = hasFeed && A.reconciledKey === _attrFilesKey(A.files);
  const leadsAll = reconciled ? _attrReconcile() : [];
  // The Reconcile step: nothing is matched until every report is in and this is pressed.
  const provsIn = [...(useGhl && ghlReady ? ['GoHighLevel'] : []), ...new Set(A.files.map(f => f.provider))];
  const dates = A.files.flatMap(f => [f.from, f.to]).filter(Boolean).sort();
  const feedLbl = (useGhl && ghlReady ? 'GoHighLevel' + (A.files.length ? ' + ' : '') : '') + (A.files.length ? A.files.length + ' report' + (A.files.length === 1 ? '' : 's') : '');
  const reconcileCard = hasFeed ? el('div', { class: 'card p-4 flex items-center gap-3 flex-wrap', style: reconciled ? {} : { borderColor: 'var(--accent)' } },
    el('div', { class: 'flex flex-col gap-0.5 min-w-0' },
      el('div', { class: 'text-sm font-bold' }, reconciled ? 'Reconciled · ' + feedLbl : feedLbl + ' ready to reconcile'),
      el('div', { class: 'text-[11px]', style: muted }, provsIn.join(', ') + ' · ' + (_attrActiveOnly() ? 'active subscriptions with an appointment' : 'all sales') + ' since ' + _attrSince() + (A.files.length ? ' · uploaded leads ' + (dates[0] || '?') + ' → ' + (dates[dates.length - 1] || '?') + ' (' + A.files.reduce((t, f) => t + (f.leads || []).length, 0).toLocaleString() + ')' : '')
        + (reconciled ? ' · run ' + new Date(A.reconciledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (A.reconciledBy ? ' by ' + A.reconciledBy : '') : A.reconciledKey ? ' · reports changed since the last reconcile' : ''))),
    el('button', { class: btn + ' ml-auto', style: reconciled ? { borderColor: 'var(--border-2)' } : primary, onclick: () => _attrRunReconcile() }, reconciled ? '↻ Re-run reconcile' : 'Reconcile against FieldRoutes →')) : null;
  // Uploaded files
  const filesCard = A.files.length ? el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-2 border-b text-[10px] uppercase tracking-widest font-semibold', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } }, 'Uploaded lead files'),
    ...A.files.map(f => el('div', { class: 'flex items-center gap-3 px-4 py-1.5 border-t text-[11px]', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'font-semibold', style: { minWidth: '140px' } }, f.provider), el('span', { class: 'flex-1 min-w-0 truncate' }, f.fileName),
      (() => { if (!reconciled) return el('span', { class: 'font-semibold' }, (f.leads || []).length.toLocaleString() + ' leads'); const st = _attrStats(leadsAll.filter(l => l.fileId === f.id)); return el('span', { class: 'font-semibold' }, st.leads.toLocaleString() + ' leads · ' + st.closes.toLocaleString() + ' closes · ' + st.fixes.toLocaleString() + ' fixes'); })(),
      el('span', { style: muted }, (f.from || '?') + ' → ' + (f.to || '?') + ' · uploaded ' + new Date(f.uploadedAt).toLocaleDateString() + (f.uploadedBy ? ' by ' + f.uploadedBy : '')),
      el('button', { class: 'text-[11px] font-semibold', style: { color: '#A9441F' }, onclick: () => { if (!confirm('Remove ' + f.fileName + '?')) return; A.files = A.files.filter(x => x.id !== f.id); _attrSave(); mountApp(); } }, 'Remove')))) : null;
  if (!hasFeed) return el('div', { class: 'flex flex-col gap-4' }, feedCard, upload, mapping,
    el('div', { class: 'card p-6 text-[11px] text-center', style: muted }, Gst == null ? 'Loading GoHighLevel leads…' : 'No lead feed yet. Turn on GoHighLevel above (once its sync has run) or upload a provider’s lead report, then press Reconcile.'));
  if (!reconciled) return el('div', { class: 'flex flex-col gap-4' }, feedCard, reconcileCard, upload, mapping, filesCard);
  const leads = leadsAll;
  const provFilter = state._attrProv || 'all';
  const inProv = leads.filter(l => provFilter === 'all' || l.provider === provFilter);
  const count = (st) => inProv.filter(l => l.status === st && !l.dupe).length;
  const provs = [...new Set(leads.map(l => l.provider))].filter(p => p !== ATTR_ORGANIC).sort();
  const provPick = el('select', { class: btn, style: { borderColor: 'var(--border-2)', background: 'var(--card)' }, onchange: (e) => { state._attrProv = e.target.value; mountApp(); } },
    el('option', { value: 'all', selected: provFilter === 'all' }, 'All providers'), ...provs.map(p => el('option', { value: p, selected: provFilter === p }, p)));
  const stFilter = state._attrStatus || 'fix';
  const tile = (key, label, n, color) => el('button', { class: 'card p-3 text-left min-w-0', style: stFilter === key ? { borderColor: 'var(--accent)', boxShadow: '0 0 0 1px var(--accent)' } : {}, onclick: () => { state._attrStatus = key; mountApp(); } },
    el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: muted }, label),
    el('div', { class: 'text-2xl font-black tabular-nums mt-1', style: { color: color || 'var(--text)' } }, n.toLocaleString()));
  const fixN = inProv.filter(_attrIsFix).length;
  const tiles = el('div', { class: 'grid gap-3', style: { gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))' } },
    tile('fix', 'To change in FieldRoutes', fixN, fixN ? '#DC2626' : 'var(--ok)'),
    tile('all', 'Leads', inProv.filter(l => l.status !== 'toorganic').length),
    tile('correct', 'Sourced correctly', count('correct'), 'var(--ok)'),
    tile('nosource', 'No source', count('nosource'), '#DC2626'),
    tile('missourced', 'Mis-sourced', count('missourced'), '#DC2626'),
    tile('toorganic', 'No lead · set Organic', count('toorganic'), '#DC2626'),
    tile('otherwon', 'Last touch elsewhere', count('otherwon'), '#B45309'),
    inProv.some(l => l.inGhl != null) ? tile('noghl', 'Not in GoHighLevel', inProv.filter(l => l.inGhl === false).length, '#B45309') : null,
    tile('d2d', 'Door to Door (kept)', inProv.filter(l => l.status === 'd2d').length),
    tile('kept', 'Protected source (kept)', inProv.filter(l => l.status === 'kept').length),
    tile('booked', 'Booked online (kept)', inProv.filter(l => l.status === 'booked').length),
    tile('existing', 'Already customers', count('existing')),
    tile('nosale', 'No sale', count('nosale') + count('nomatch')));
  const sold = inProv.filter(l => l.sale && l.isWinner && !l.dupe && l.status !== 'toorganic' && l.status !== 'd2d' && l.status !== 'kept' && l.status !== 'booked');
  const closeLine = el('div', { class: 'text-[11px]', style: muted },
    'Sales credited by last touch: ' + sold.length.toLocaleString() + ' · ' + fmt.usd0(sold.reduce((t, l) => t + (Number(l.sale.subscription_contract_value) || 0), 0)) + ' contract value · lead → sale ' + (_attrStats(inProv).leads ? Math.round(sold.filter(l => l.status !== 'toorganic').length / _attrStats(inProv).leads * 1000) / 10 : 0) + '%');
  const list = inProv.filter(l => stFilter === 'all' ? true : stFilter === 'fix' ? _attrIsFix(l) : stFilter === 'nosale' ? (l.status === 'nosale' || l.status === 'nomatch') : stFilter === 'noghl' ? l.inGhl === false : l.status === stFilter)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, t);
  const td = (v, st) => el('td', { class: 'px-2 py-1.5 whitespace-nowrap', style: st || {} }, v == null || v === '' ? '—' : v);
  const shown = list.slice(0, state._attrMore ? 20000 : 200);
  const red = { color: '#DC2626', fontWeight: '600' };
  const fmtPh = (v) => { const d = _attrDigits(v); return d ? '(' + d.slice(0, 3) + ') ' + d.slice(3, 6) + '-' + d.slice(6) : null; };
  const table = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, stFilter === 'fix' ? 'Accounts to change in FieldRoutes' : 'Leads · ' + (stFilter === 'all' ? 'all' : (ATTR_STATUS[stFilter] || [stFilter])[0])),
      el('span', { class: 'text-[11px]', style: muted }, list.length.toLocaleString() + ' rows'),
      el('button', { class: btn + ' ml-auto', style: { borderColor: 'var(--border-2)' }, onclick: () => _attrExport(list) }, '↓ Excel')),
    list.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', {}, th('Lead'), th('Phone #'), th('Customer #'), th('Date Sold'), th('Current Source'), th('Current Lead Date'), th('Correct Source'), th('Correct Lead Date'), th('Matched By'), th('Channel Touches'), th('Reconciled From'), th('Rule'), th('Status'))),
      el('tbody', {}, ...shown.map(l => { const tr = el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(l.name || l.email), td(fmtPh(l.phone || (l.sale && l.sale.phone))),
        td(l.custId ? '#' + l.custId : null), td(l.sale ? String(l.sale.sold_date).slice(0, 10) : null),
        td(l.sale ? reportingSourceOf(l.sale) : null, _attrIsFix(l) ? red : {}), td(_attrCurDate(l), muted),
        td(_attrShould(l)[0], _attrIsFix(l) ? { fontWeight: '700' } : {}), td(_attrShould(l)[1]),
        td(l.status === 'toorganic' ? l.why : l.matchHow), el('td', { class: 'px-2 py-1.5 whitespace-nowrap' }, el('button', { class: 'underline', style: { color: 'var(--accent)', minHeight: '24px' }, title: 'Show every record we have for this person',
          onclick: () => { const nx = tr.nextSibling; if (nx && nx.getAttribute && nx.getAttribute('data-attr-trail')) { nx.remove(); return; } tr.after(_attrTrailNode(l, 13)); } },
          ((l.touches || []).length ? l.touches.join(', ') : 'view') + ' ▾')),
        td(l.via === 'ghl' ? 'GoHighLevel' : l.via === 'file' ? 'Report' : null), td(l.sale && l.isWinner && l.rule ? l.rule : null, l.rule && l.rule !== 'last touch' ? { color: '#B45309', fontWeight: '600' } : {}),
        td((ATTR_STATUS[l.status] || [l.status])[0] + (l.dupe ? ' (repeat lead)' : ''), { color: (ATTR_STATUS[l.status] || [])[1] || 'var(--text)', fontWeight: '600' })); return tr; })))) :
      el('div', { class: 'px-4 py-6 text-[11px] text-center', style: muted }, stFilter === 'fix' ? 'Nothing to change — every credited sale is sourced correctly.' : 'No rows.'),
    list.length > shown.length ? el('button', { class: 'w-full px-4 py-2 text-[11px] font-semibold border-t', style: { borderColor: 'var(--border)', color: 'var(--accent)' }, onclick: () => { state._attrMore = true; mountApp(); } }, 'Show all ' + list.length.toLocaleString()) : null);
  // Leads / closes / fixes by provider (per Isaac) — last paid touch, else Organic.
  const byProv = [...provs, ATTR_ORGANIC].map(p => ({ p, ...(_attrStats(leads.filter(l => l.provider === p))) })).filter(x => x.leads || x.fixes);
  const tot = _attrStats(leads);
  const th2 = (t) => el('th', { class: 'px-3 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold', style: muted }, t);
  const td2 = (v, st) => el('td', { class: 'px-3 py-1.5 tabular-nums', style: st || {} }, v);
  const summary = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-2 border-b text-[10px] uppercase tracking-widest font-semibold', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } }, 'Leads · closes · fixes by provider — last paid touch gets the close (priority window first); no paid touch = Organic'),
    el('table', { class: 'w-full text-[11px]' }, el('thead', {}, el('tr', {}, th2('Provider'), th2('Leads'), th2('Closes'), th2('Close rate'), th2('Closed contract value'), th2('Fixes in FieldRoutes'))),
      el('tbody', {}, ...byProv.map(x => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td2(x.p, { fontWeight: '600' }), td2(x.p === ATTR_ORGANIC ? '—' : x.leads.toLocaleString()), td2(x.p === ATTR_ORGANIC ? '—' : x.closes.toLocaleString()),
        td2(x.p === ATTR_ORGANIC || !x.leads ? '—' : (Math.round(x.closes / x.leads * 1000) / 10) + '%'), td2(x.p === ATTR_ORGANIC ? '—' : fmt.usd0(x.closeValue)),
        td2(x.fixes.toLocaleString(), x.fixes ? { color: '#DC2626', fontWeight: '700' } : { color: 'var(--ok)' }))),
        el('tr', { class: 'border-t', style: { borderColor: 'var(--border)', background: 'var(--card-2)' } }, td2('Total', { fontWeight: '700' }), td2(tot.leads.toLocaleString(), { fontWeight: '700' }), td2(tot.closes.toLocaleString(), { fontWeight: '700' }),
          td2(tot.leads ? (Math.round(tot.closes / tot.leads * 1000) / 10) + '%' : '—', { fontWeight: '700' }), td2(fmt.usd0(tot.closeValue), { fontWeight: '700' }), td2(tot.fixes.toLocaleString(), { fontWeight: '700', color: tot.fixes ? '#DC2626' : 'var(--ok)' })))));
  const U = null;
  const lastUp = U && U.per ? el('div', { class: 'card px-4 py-2 flex flex-col gap-1 text-[12px]', style: { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 8%, var(--card))' } },
    el('div', { class: 'flex items-center gap-3' },
      el('span', { class: 'font-bold' }, 'Just uploaded · ' + U.per.length + ' file' + (U.per.length === 1 ? '' : 's')),
      el('span', { class: 'font-semibold' }, U.leads.toLocaleString() + ' leads · ' + U.closes.toLocaleString() + ' closes (' + fmt.usd0(U.closeValue) + ') · ' + U.fixes.toLocaleString() + ' fixes + ' + (U.organicFixes || 0).toLocaleString() + ' to Organic'),
      el('button', { class: 'ml-auto text-[11px]', style: muted, onclick: () => { state._attrLastUpload = null; mountApp(); } }, '✕')),
    ...(U.per.length > 1 ? U.per.map(x => el('div', { class: 'text-[11px]', style: muted }, x.provider + ' · ' + x.fileName + ' — ' + x.leads.toLocaleString() + ' leads · ' + x.closes.toLocaleString() + ' closes · ' + x.fixes.toLocaleString() + ' fixes')) : [])) : null;
  return el('div', { class: 'flex flex-col gap-4' }, feedCard, reconcileCard, upload, mapping, summary,
    el('div', { class: 'flex items-center gap-2 flex-wrap' }, el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Provider'), provPick, closeLine),
    tiles, table, filesCard);
}
