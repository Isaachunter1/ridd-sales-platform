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
const ATTR_WINDOW_DAYS = 60;   // a sale counts for a lead when sold within 60 days after the lead (3 days grace before)

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
      const j = JSON.parse(txt); state._attr = { files: Array.isArray(j.files) ? j.files : [], maps: (j.maps && typeof j.maps === 'object') ? j.maps : {}, reconciledKey: j.reconciledKey || null, reconciledAt: j.reconciledAt || null, reconciledBy: j.reconciledBy || null };
    }
  } catch (e) { state._attr = { files: [] }; }
  mountApp();
}
async function _attrSave() {
  if (!supabase || (typeof DEMO !== 'undefined' && DEMO)) return;
  try {
    const blob = await new Response(new Blob([JSON.stringify({ files: state._attr.files, maps: state._attr.maps || {}, reconciledKey: state._attr.reconciledKey || null, reconciledAt: state._attr.reconciledAt || null, reconciledBy: state._attr.reconciledBy || null, savedAt: new Date().toISOString() })]).stream().pipeThrough(new CompressionStream('gzip'))).blob();
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
  const idx = _attrCrmIndex();
  const leads = [];
  for (const f of files) for (const l of f.leads || []) leads.push({ ...l, provider: f.provider, fileId: f.id });
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
    const lo = _attrAddDays(l.date, -3), hi = _attrAddDays(l.date, ATTR_WINDOW_DAYS);
    const cands = c.subs.filter(r => { const sd = String(r.sold_date || '').slice(0, 10); return sd >= lo && sd <= hi && (typeof reportingSourceClass !== 'function' || reportingSourceClass(reportingSourceOf(r)) !== 'renewal'); })
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
    pool.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a.provider).localeCompare(String(b.provider)));
    const win = pool[0];
    const touches = [...new Set(ls.map(y => y.provider))];
    for (const x of ls) { x.winner = win.provider; x.isWinner = x.provider === win.provider; x.touches = touches; }
  }
  // 4. Classify.
  for (const l of leads) {
    const c = l.custId ? idx.cust.get(l.custId) : null;
    if (!c) { l.status = 'nomatch'; continue; }
    if (!l.sale) {
      const before = c.subs.some(r => String(r.sold_date || '') < String(l.date || '9999'));
      l.status = before ? 'existing' : 'nosale'; continue;
    }
    if (!l.isWinner) { l.status = 'otherwon'; continue; }
    const cur = reportingSourceOf(l.sale);
    l.currentSource = cur;
    l.status = cur === l.provider ? 'correct' : _attrIsUnset(cur) ? 'nosource' : 'missourced';
  }
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
  const allFrom = [...cover.values()].map(c => c[0]).sort()[0], allTo = [...cover.values()].map(c => c[1]).sort().slice(-1)[0];
  const organic = [];
  if (allFrom) for (const r of state.reportingSubscriptions || []) {
    const sd = String(r.sold_date || '').slice(0, 10); if (!sd) continue;
    const k = String(r.subscription_id || (r.customer_id + '|' + r.sold_date)); if (credited.has(k)) continue;
    if (typeof reportingIsOfficeStaff === 'function' && !reportingIsOfficeStaff(r)) continue;
    const src = reportingSourceOf(r);
    if (typeof reportingSourceClass === 'function' && reportingSourceClass(src) !== 'new') continue;
    const cv = cover.get(src);
    const inPaid = cv && sd >= cv[0] && sd <= _attrAddDays(cv[1], ATTR_WINDOW_DAYS);
    const inAny = sd >= allFrom && sd <= _attrAddDays(allTo, ATTR_WINDOW_DAYS);
    if (inPaid || (inAny && _attrIsUnset(src))) organic.push({ provider: ATTR_ORGANIC, date: '', name: [r.first_name, r.last_name].filter(Boolean).join(' '), custId: String(r.customer_id), sale: r, isWinner: true, currentSource: src,
      status: 'toorganic', why: inPaid ? src + '’s report has no lead for them' : 'no paid lead' });
  }
  return leads.concat(organic);
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
};
const _attrIsFix = (l) => (l.status === 'nosource' || l.status === 'missourced' || l.status === 'toorganic') && !l.dupe;
// Leads / closes / fixes for a set of rows (closes = sales credited by last paid touch, once per sale).
function _attrStats(rows) {
  const leadRows = rows.filter(l => l.status !== 'toorganic');
  const closes = leadRows.filter(l => l.sale && l.isWinner && !l.dupe);
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
const _attrFilesKey = (files) => (files || []).map(f => f.id).sort().join(',');
function _attrRunReconcile() {
  const A = state._attr; if (!A || !A.files.length) return;
  A.reconciledKey = _attrFilesKey(A.files); A.reconciledAt = new Date().toISOString(); A.reconciledBy = state.profile && state.profile.full_name;
  state._attrStatus = 'fix';
  _attrSave();
  const rec = _attrReconcile(); const st = _attrStats(rec);
  toast('Reconciled ' + A.files.length + ' reports: ' + st.leads.toLocaleString() + ' leads · ' + st.closes.toLocaleString() + ' closes · ' + st.fixes.toLocaleString() + ' fixes', 'success');
  mountApp();
}

async function _attrExport(rows) {
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library', 'error'); return; }
  const H = ['Customer #', 'Customer', 'Subscription #', 'Service', 'Sold', 'Current source', 'Should be', 'Lead provider', 'Lead date', 'Lead name', 'Lead phone', 'Lead email', 'Matched by', 'All providers touched', 'Status'];
  const data = rows.map(l => [l.custId || '', l.sale ? [l.sale.first_name, l.sale.last_name].filter(Boolean).join(' ') : '', l.sale ? l.sale.subscription_id : '', l.sale ? l.sale.subscription : '', l.sale ? String(l.sale.sold_date).slice(0, 10) : '', l.sale ? reportingSourceOf(l.sale) : '', _attrIsFix(l) ? (l.status === 'toorganic' ? ATTR_ORGANIC : l.provider) : l.status === 'otherwon' ? l.winner : '', l.provider, l.date, l.name, l.phone, l.email, l.matchHow || '', (l.touches || [l.provider]).join(', '), (ATTR_STATUS[l.status] || [l.status])[0]]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([H, ...data]), 'Lead reconciliation');
  XLSX.writeFile(wb, 'RIDD-lead-reconciliation-' + new Date().toISOString().slice(0, 10) + '.xlsx');
}

// ── the view ──
function mktgAttributionView() {
  _attrLoad();
  const A = state._attr;
  const muted = { color: 'var(--text-muted)' };
  if (A === undefined || A === null) return el('div', { class: 'card p-6 text-[11px] text-center', style: muted }, 'Loading lead uploads…');
  if (!(state.reportingSubscriptions || []).length) return el('div', { class: 'card p-6 text-[11px] text-center', style: muted }, 'Waiting for the CRM snapshot to load…');
  const sources = [...new Set([...(state.reportingSourceConfig || []).map(c => c.source), ...(state.reportingSubscriptions || []).map(r => reportingSourceOf(r))])]
    .filter(s => s && !_attrIsUnset(s) && (typeof reportingSourceClass !== 'function' || reportingSourceClass(s) === 'new') && !(typeof crmSourceIs === 'function' && crmSourceIs('d2d', s))).sort();
  const btn = 'rounded-lg border px-2.5 py-1 text-[11px] font-semibold';
  const primary = { background: 'var(--accent)', color: 'var(--accent-text)', borderColor: 'var(--accent)' };
  // Upload bar
  const provSel = el('select', { class: btn, style: { borderColor: 'var(--border-2)', background: 'var(--card)' }, onchange: (e) => { state._attrUpProv = e.target.value; } },
    el('option', { value: '' }, 'Default provider (else from file name)…'), ...sources.map(s => el('option', { value: s, selected: state._attrUpProv === s }, s)));
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.csv,.xlsx,.xls', style: { display: 'none' }, onchange: (e) => { const fs = e.target.files; if (fs && fs.length) _attrUpload(fs, sources); e.target.value = ''; } });
  const upload = el('div', { class: 'card p-3 flex items-center gap-2 flex-wrap' },
    el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Upload leads'), provSel, fileIn,
    el('button', { class: btn, style: primary, onclick: () => fileIn.click() }, '↑ Choose files (one or many)'),
    el('span', { class: 'text-[10px]', style: muted }, 'Last touch wins across every provider uploaded · a lead counts toward a sale made within ' + ATTR_WINDOW_DAYS + ' days after it · matched by phone, then email, then last name + ZIP'));
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
  const reconciled = !!A.files.length && A.reconciledKey === _attrFilesKey(A.files);
  const leadsAll = reconciled ? _attrReconcile() : [];
  // The Reconcile step: nothing is matched until every report is in and this is pressed.
  const provsIn = [...new Set(A.files.map(f => f.provider))].sort();
  const dates = A.files.flatMap(f => [f.from, f.to]).filter(Boolean).sort();
  const reconcileCard = A.files.length ? el('div', { class: 'card p-4 flex items-center gap-3 flex-wrap', style: reconciled ? {} : { borderColor: 'var(--accent)' } },
    el('div', { class: 'flex flex-col gap-0.5 min-w-0' },
      el('div', { class: 'text-sm font-bold' }, reconciled ? 'Reconciled · ' + A.files.length + ' report' + (A.files.length === 1 ? '' : 's') : A.files.length + ' report' + (A.files.length === 1 ? '' : 's') + ' ready to reconcile'),
      el('div', { class: 'text-[11px]', style: muted }, provsIn.join(', ') + ' · leads ' + (dates[0] || '?') + ' → ' + (dates[dates.length - 1] || '?') + ' · ' + A.files.reduce((t, f) => t + (f.leads || []).length, 0).toLocaleString() + ' leads'
        + (reconciled ? ' · run ' + new Date(A.reconciledAt).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (A.reconciledBy ? ' by ' + A.reconciledBy : '') : A.reconciledKey ? ' · reports changed since the last reconcile' : ''))),
    el('button', { class: btn + ' ml-auto', style: reconciled ? { borderColor: 'var(--border-2)' } : primary, onclick: () => _attrRunReconcile() }, reconciled ? '↻ Re-run reconcile' : 'Reconcile all reports →')) : null;
  // Uploaded files
  const filesCard = A.files.length ? el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-2 border-b text-[10px] uppercase tracking-widest font-semibold', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } }, 'Uploaded lead files'),
    ...A.files.map(f => el('div', { class: 'flex items-center gap-3 px-4 py-1.5 border-t text-[11px]', style: { borderColor: 'var(--border)' } },
      el('span', { class: 'font-semibold', style: { minWidth: '140px' } }, f.provider), el('span', { class: 'flex-1 min-w-0 truncate' }, f.fileName),
      (() => { if (!reconciled) return el('span', { class: 'font-semibold' }, (f.leads || []).length.toLocaleString() + ' leads'); const st = _attrStats(leadsAll.filter(l => l.fileId === f.id)); return el('span', { class: 'font-semibold' }, st.leads.toLocaleString() + ' leads · ' + st.closes.toLocaleString() + ' closes · ' + st.fixes.toLocaleString() + ' fixes'); })(),
      el('span', { style: muted }, (f.from || '?') + ' → ' + (f.to || '?') + ' · uploaded ' + new Date(f.uploadedAt).toLocaleDateString() + (f.uploadedBy ? ' by ' + f.uploadedBy : '')),
      el('button', { class: 'text-[11px] font-semibold', style: { color: '#A9441F' }, onclick: () => { if (!confirm('Remove ' + f.fileName + '?')) return; A.files = A.files.filter(x => x.id !== f.id); _attrSave(); mountApp(); } }, 'Remove')))) : null;
  if (!A.files.length) return el('div', { class: 'flex flex-col gap-4' }, upload, mapping,
    el('div', { class: 'card p-6 text-[11px] text-center', style: muted }, 'Upload every provider’s lead report (CSV or Excel), then press Reconcile to match them all against FieldRoutes.'));
  if (!reconciled) return el('div', { class: 'flex flex-col gap-4' }, upload, mapping, reconcileCard, filesCard);
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
    tile('toorganic', 'Should be Organic', count('toorganic'), '#DC2626'),
    tile('otherwon', 'Last touch elsewhere', count('otherwon'), '#B45309'),
    tile('existing', 'Already customers', count('existing')),
    tile('nosale', 'No sale', count('nosale') + count('nomatch')));
  const sold = inProv.filter(l => l.sale && l.isWinner && !l.dupe && l.status !== 'toorganic');
  const closeLine = el('div', { class: 'text-[11px]', style: muted },
    'Sales credited by last touch: ' + sold.length.toLocaleString() + ' · ' + fmt.usd0(sold.reduce((t, l) => t + (Number(l.sale.subscription_contract_value) || 0), 0)) + ' contract value · lead → sale ' + (_attrStats(inProv).leads ? Math.round(sold.filter(l => l.status !== 'toorganic').length / _attrStats(inProv).leads * 1000) / 10 : 0) + '%');
  const list = inProv.filter(l => stFilter === 'all' ? true : stFilter === 'fix' ? _attrIsFix(l) : stFilter === 'nosale' ? (l.status === 'nosale' || l.status === 'nomatch') : l.status === stFilter)
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const th = (t) => el('th', { class: 'px-2 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, t);
  const td = (v, st) => el('td', { class: 'px-2 py-1.5 whitespace-nowrap', style: st || {} }, v == null || v === '' ? '—' : v);
  const shown = list.slice(0, state._attrMore ? 20000 : 200);
  const red = { color: '#DC2626', fontWeight: '600' };
  const table = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
      el('h3', { class: 'text-sm font-bold' }, stFilter === 'fix' ? 'Accounts to change in FieldRoutes' : 'Leads · ' + (stFilter === 'all' ? 'all' : (ATTR_STATUS[stFilter] || [stFilter])[0])),
      el('span', { class: 'text-[11px]', style: muted }, list.length.toLocaleString() + ' rows'),
      el('button', { class: btn + ' ml-auto', style: { borderColor: 'var(--border-2)' }, onclick: () => _attrExport(list) }, '↓ Excel')),
    list.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', {}, th('Lead date'), th('Provider'), th('Lead'), th('Customer #'), th('Subscription'), th('Sold'), th('Current source'), th('Should be'), th('Matched by'), th('Touched by'), th('Status'))),
      el('tbody', {}, ...shown.map(l => el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        td(l.date), td(l.provider), td(l.name || l.phone || l.email),
        td(l.custId ? '#' + l.custId : null), td(l.sale ? l.sale.subscription + ' #' + l.sale.subscription_id : null), td(l.sale ? String(l.sale.sold_date).slice(0, 10) : null),
        td(l.sale ? reportingSourceOf(l.sale) : null, _attrIsFix(l) ? red : {}),
        td(_attrIsFix(l) ? (l.status === 'toorganic' ? ATTR_ORGANIC : l.provider) : l.status === 'otherwon' ? l.winner : null, _attrIsFix(l) ? { fontWeight: '700' } : {}),
        td(l.status === 'toorganic' ? l.why : l.matchHow), td((l.touches || []).length > 1 ? l.touches.join(', ') : null),
        td((ATTR_STATUS[l.status] || [l.status])[0] + (l.dupe ? ' (repeat lead)' : ''), { color: (ATTR_STATUS[l.status] || [])[1] || 'var(--text)', fontWeight: '600' })))))) :
      el('div', { class: 'px-4 py-6 text-[11px] text-center', style: muted }, stFilter === 'fix' ? 'Nothing to change — every credited sale is sourced correctly.' : 'No rows.'),
    list.length > shown.length ? el('button', { class: 'w-full px-4 py-2 text-[11px] font-semibold border-t', style: { borderColor: 'var(--border)', color: 'var(--accent)' }, onclick: () => { state._attrMore = true; mountApp(); } }, 'Show all ' + list.length.toLocaleString()) : null);
  // Leads / closes / fixes by provider (per Isaac) — last paid touch, else Organic.
  const byProv = [...provs, ATTR_ORGANIC].map(p => ({ p, ...(_attrStats(leads.filter(l => l.provider === p))) })).filter(x => x.leads || x.fixes);
  const tot = _attrStats(leads);
  const th2 = (t) => el('th', { class: 'px-3 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold', style: muted }, t);
  const td2 = (v, st) => el('td', { class: 'px-3 py-1.5 tabular-nums', style: st || {} }, v);
  const summary = el('div', { class: 'card overflow-hidden' },
    el('div', { class: 'px-4 py-2 border-b text-[10px] uppercase tracking-widest font-semibold', style: { borderColor: 'var(--border)', color: 'var(--text-muted)' } }, 'Leads · closes · fixes by provider — last paid touch gets the close; no paid touch = Organic'),
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
  return el('div', { class: 'flex flex-col gap-4' }, upload, mapping, reconcileCard, summary,
    el('div', { class: 'flex items-center gap-2 flex-wrap' }, el('span', { class: 'text-[10px] uppercase tracking-widest font-semibold text-muted-' }, 'Provider'), provPick, closeLine),
    tiles, table, filesCard);
}
