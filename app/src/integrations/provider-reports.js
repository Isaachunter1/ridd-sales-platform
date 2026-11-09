// ┌─ src/integrations/provider-reports.js ────────────────────────────────
// │ Lead-provider statements that don't fit a plain spend sheet (per Isaac,
// │ Nov 9 — "we should change Spend to Providers… attribute both spend, leads,
// │ etc, by what I am getting from the lead providers' sheets and platforms"):
// │   Baton · "Net Spend" workbook — RIDD buys referrals from Baton AND sells
// │     referrals to Baton; the Net Spend tab nets the two by month, and its
// │     city block gives the leads bought and dollars by branch. Net can be a
// │     credit. The raw referral tab is read too (phones, dispositions).
// │   Pest Net · "CPL Report" — a call/form log with a summary (Total Leads,
// │     Cost Per Lead, Total Amount) and no location; leads are placed by the
// │     caller's area code when it is one of RIDD's markets.
// │ A recognised workbook becomes a provider-month record (leads, gross,
// │ credits, net, by branch) that the Spend/Providers tab reads directly; the
// │ branch split of the NET dollars feeds the By-branch table, so a month still
// │ adds up to what QuickBooks should show. Stored in the marketing store as
// │ m.providerMonths[ym][channel]; the branch cells also go through the normal
// │ upload path (m.spendUploads) so nothing else changes.
// │ Part of the app.js bundle (app/src/bundle.order.js).
// └────────────────────────────────────────────────────────────────────────
const PRV_BRANCH_ALIAS = [[/richmond/i, 'VIRGINIA BEACH'], [/walton|fort walton|panama/i, 'DESTIN'], [/wilmington/i, 'MYRTLE BEACH'], [/savannah/i, 'CHARLESTON']];
function prvBranchOf(name, branches) {
  const s = String(name || '').trim(); if (!s) return '';
  const flat = s.toLowerCase().replace(/[^a-z0-9]/g, '');
  for (const b of branches) { const bk = String(b).toLowerCase().replace(/[^a-z0-9]/g, ''); if (bk.length >= 3 && flat.includes(bk)) return b; }
  for (const [re, to] of PRV_BRANCH_ALIAS) if (re.test(s)) { const hit = branches.find(b => String(b).toUpperCase() === to); if (hit) return hit; }
  return '';
}
// Area code → branch (Pest Net has no location). Only RIDD's markets; anything else is left unplaced.
const PRV_AREA_BRANCH = { 404: 'ATLANTA', 470: 'ATLANTA', 678: 'ATLANTA', 770: 'ATLANTA', 706: 'ATLANTA', 762: 'ATLANTA', 912: 'CHARLESTON', 843: 'CHARLESTON', 854: 'CHARLESTON', 919: 'RALEIGH', 984: 'RALEIGH', 910: 'MYRTLE BEACH', 757: 'VIRGINIA BEACH', 948: 'VIRGINIA BEACH', 804: 'VIRGINIA BEACH', 850: 'DESTIN', 313: 'DETROIT', 248: 'DETROIT', 734: 'DETROIT', 586: 'DETROIT', 947: 'DETROIT', 417: 'JOPLIN', 501: 'LITTLE ROCK', 801: 'SALT LAKE', 385: 'SALT LAKE' };
const _prvArea = (phone) => { const d = String(phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'); return d.length === 10 ? Number(d.slice(0, 3)) : 0; };
const _prvNum = (v) => { if (v == null || v === '') return 0; if (typeof v === 'number') return v; const n = parseFloat(String(v).replace(/[^0-9.-]/g, '')); return isNaN(n) ? 0 : n; };
const _prvYm = (d) => { if (d instanceof Date && !isNaN(d)) return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0'); const s = String(d || ''); const m = s.match(/^(\d{4})-(\d{2})/); if (m) return m[1] + '-' + m[2]; if (typeof d === 'number' && d > 30000 && d < 80000 && typeof XLSX !== 'undefined') { const p = XLSX.SSF.parse_date_code(d); if (p) return p.y + '-' + String(p.m).padStart(2, '0'); } return ''; };

// ── Baton · Net Spend workbook → { channel: 'Baton', months: { ym: { leads, gross, credits, sent, net, by: {B: gross}, leadsBy: {B: n} } } }
function prvParseBaton(wb, branches) {
  const ws = wb.Sheets[wb.SheetNames.find(n => /net\s*spend/i.test(n)) || ''];
  if (!ws) return null;
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, cellDates: true });
  const months = {};
  const M = (ym) => months[ym] || (months[ym] = { leads: 0, gross: 0, credits: 0, sent: 0, net: 0, by: {}, leadsBy: {} });
  let head = null, inCity = false, city = '';
  for (const r of rows) {
    const a = r[0], b = r[1];
    // A month header row: 6+ month cells; the label in column A says which block (company totals vs "Valid Referral Received" by city).
    const yms = r.map(v => _prvYm(v)); const nM = yms.filter(Boolean).length;
    if (nM >= 6) { head = yms; inCity = /received/i.test(String(a || '')); city = ''; continue; }
    if (!head) continue;
    const label = String(a == null ? (b == null ? '' : b) : a).trim();   // the city block's Amount rows start one cell in
    if (!inCity) {
      const put = (key) => { for (let i = 1; i < head.length; i++) if (head[i]) M(head[i])[key] += _prvNum(r[i]); };
      if (/^valid referral sent$/i.test(label)) { put('sent'); head._next = 'sentAmt'; }
      else if (/^valid referral received$/i.test(label)) { put('leads'); head._next = 'gross'; }
      else if (/^amount$/i.test(label)) { if (head._next === 'sentAmt') put('credits'); else if (head._next === 'gross') put('gross'); head._next = null; }
      else if (/^net credits$/i.test(label)) put('net');
    } else {
      if (/^city$/i.test(label)) continue;
      if (label && !/^amount$/i.test(label) && /received/i.test(String(b || ''))) { city = label; for (let i = 2; i < head.length; i++) if (head[i]) { const n = _prvNum(r[i]); if (n) { const br = prvBranchOf(city, branches) || city; M(head[i]).leadsBy[br] = (M(head[i]).leadsBy[br] || 0) + n; } } continue; }
      if (/^amount$/i.test(label) && city) { for (let i = 1; i < head.length; i++) if (head[i] && typeof r[i] === 'number') { const v = _prvNum(r[i]); if (v) { const br = prvBranchOf(city, branches) || city; M(head[i]).by[br] = (M(head[i]).by[br] || 0) + v; } } }
    }
  }
  for (const ym in months) { const m = months[ym]; if (!m.leads && !m.gross && !m.credits && !m.sent) delete months[ym]; else m.net = Math.round((m.gross - m.credits) * 100) / 100; }
  if (!Object.keys(months).length) return null;
  // Raw referral tab (if present): received leads with phone + disposition, by month — for matching later.
  const raw = wb.Sheets[wb.SheetNames.find(n => /^raw/i.test(n)) || ''];
  const leads = [];
  if (raw) {
    const rr = XLSX.utils.sheet_to_json(raw, { defval: null, raw: true });
    const ours = (() => { const c = new Map(); for (const x of rr) { const t = String(x.toCompanyName || ''); if (/ridd/i.test(t)) c.set(t, (c.get(t) || 0) + 1); } return [...c.keys()]; })();
    for (const x of rr) {
      if (!ours.includes(String(x.toCompanyName || ''))) continue;
      if (!/^(true|1|yes)$/i.test(String(x.isValid).trim())) continue;
      const ym = (x.Year && x.Month) ? String(x.Year).replace(/\.0+$/, '') + '-' + String(x.Month).replace(/\.0+$/, '').padStart(2, '0') : String(x.dateSubmitted || '').slice(0, 7);
      leads.push({ ym, phone: String(x.phone || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1'), branch: prvBranchOf(x.toServiceAreaName, branches) || '', amt: _prvNum(x.bidAmount), disp: String(x.disposition || ''), zip: String(x.postalCode == null ? '' : x.postalCode).replace(/\.0+$/, '').padStart(5, '0').slice(0, 5) });
    }
  }
  return { channel: 'Baton', kind: 'baton', months, leads, note: 'Net = leads bought minus credits for referrals RIDD sent. A negative net is money Baton owes RIDD.' };
}

// ── Pest Net · CPL Report → one month: { leads, gross (= net), by (area code), leadsBy }
function prvParsePestNet(wb, branches) {
  const ws = wb.Sheets[wb.SheetNames.find(n => /cpl/i.test(n)) || wb.SheetNames[0]];
  if (!ws) return null;
  const all = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true, cellDates: true });
  const hi = all.findIndex(r => (r || []).some(v => /^customer #$/i.test(String(v == null ? '' : v).trim())));   // the header row (the sheet may start with blank rows)
  if (hi < 0) return null;
  const rows = all.slice(hi);
  const hdr = (rows[0] || []).map(v => String(v == null ? '' : v).trim().toLowerCase());
  if (!hdr.includes('type')) return null;
  const iPhone = hdr.indexOf('customer #'), iDate = hdr.indexOf('date'), iType = hdr.indexOf('type');
  const summary = {};
  for (const r of rows) for (let i = 0; i < r.length - 1; i++) { const k = String(r[i] == null ? '' : r[i]).trim().toLowerCase(); if (/^(total leads|cost per lead|total amount|total phone|form leads)/.test(k)) { const v = r.slice(i + 1).find(x => typeof x === 'number'); if (v != null) summary[k] = v; } }
  const months = {};
  const M = (ym) => months[ym] || (months[ym] = { leads: 0, gross: 0, credits: 0, sent: 0, net: 0, by: {}, leadsBy: {}, unplacedLeads: 0 });
  const leads = [];
  for (const r of rows.slice(1)) {
    const type = String(r[iType] == null ? '' : r[iType]).trim(); if (!/lead/i.test(type)) continue;   // billed rows only ("Call Lead" / "Form Lead")
    const ym = _prvYm(r[iDate]); if (!ym) continue;
    const phone = String(r[iPhone] || '').replace(/\D/g, '').replace(/^1(\d{10})$/, '$1');
    const br = PRV_AREA_BRANCH[_prvArea(phone)] || '';
    const m = M(ym); m.leads++; if (br) m.leadsBy[br] = (m.leadsBy[br] || 0) + 1; else m.unplacedLeads++;
    leads.push({ ym, phone, branch: br, amt: 0, disp: type });
  }
  const yms = Object.keys(months); if (!yms.length) return null;
  const cpl = _prvNum(summary['cost per lead']), total = _prvNum(summary['total amount']);
  const totalLeads = yms.reduce((a, k) => a + months[k].leads, 0);
  for (const ym of yms) { const m = months[ym]; const gross = total && totalLeads ? Math.round(total * m.leads / totalLeads * 100) / 100 : cpl * m.leads; m.gross = gross; m.net = gross; for (const l of leads) if (l.ym === ym) l.amt = cpl || (m.leads ? gross / m.leads : 0);
    const placed = Object.values(m.leadsBy).reduce((a, v) => a + v, 0); for (const b in m.leadsBy) m.by[b] = Math.round(gross * m.leadsBy[b] / m.leads * 100) / 100; m.unplacedAmt = Math.round(gross * (m.leads - placed) / m.leads * 100) / 100; }
  return { channel: 'Pest Net', kind: 'pestnet', months, leads, cpl, note: 'Billed leads = rows typed Call Lead / Form Lead (calls over 60 seconds and web forms), at the report’s cost per lead. Placed by the caller’s area code; other area codes are spread with the rest.' };
}

// Try every provider parser; null when the workbook is a plain spend sheet.
function prvParseWorkbook(wb, fileName, branches) {
  const names = wb.SheetNames.join(' ');
  if (/net\s*spend/i.test(names) || /baton/i.test(fileName || '')) { const r = prvParseBaton(wb, branches); if (r) return r; }
  if (/cpl/i.test(names) || /pest\s*net|cpl/i.test(fileName || '')) { const r = prvParsePestNet(wb, branches); if (r) return r; }
  return null;
}

// ── Store: m.providerMonths[ym][channel] = { leads, gross, credits, sent, net, by, leadsBy, from, at }
function prvStore() { const m = _mktgStore(); m.providerMonths = (m.providerMonths && typeof m.providerMonths === 'object') ? m.providerMonths : {}; return m; }
function prvMonth(ym, channel) { const m = prvStore(); return (m.providerMonths[ym] || {})[channel] || null; }
function prvMonthsFor(ym) { return prvStore().providerMonths[ym] || {}; }
// Commit a parsed statement: provider months + an upload record whose branch cells carry the NET dollars.
function prvCommit(R, fileName, branches) {
  const m = prvStore();
  const yms = Object.keys(R.months).sort();
  const cells = {};
  for (const ym of yms) {
    const x = R.months[ym];
    const grossPlaced = Object.values(x.by).reduce((a, v) => a + v, 0);
    const c = {};
    if (x.net && grossPlaced > 0) { const f = x.net / grossPlaced; for (const b in x.by) if (branches.includes(b)) c[b] = Math.round(x.by[b] * f * 100) / 100; }
    cells[ym] = c;
    (m.providerMonths[ym] = m.providerMonths[ym] || {})[R.channel] = Object.assign({}, x, { from: fileName, at: new Date().toISOString(), leadsN: (R.leads || []).filter(l => l.ym === ym).length });
  }
  // One upload record per statement + channel (replacing an earlier statement for the same channel + months).
  m.spendUploads = (m.spendUploads || []).filter(u => !(u.channel === R.channel && u.provider && yms.some(ym => u.cells && u.cells[ym])));
  const total = yms.reduce((a, ym) => a + (R.months[ym].net || 0), 0);
  m.spendUploads.push({ id: 'prv-' + Date.now().toString(36), fileName, channel: R.channel, provider: R.kind, at: new Date().toISOString(), by: (state.profile && state.profile.full_name) || '', total: Math.round(total * 100) / 100, n: yms.length, cells });
  if (typeof _spuRebuild === 'function') _spuRebuild(m, R.channel, yms);
  // Make sure the channel exists and the vendor's QuickBooks lines use the upload as their driver.
  if (Array.isArray(m.channels) && !m.channels.some(c => String(c).toLowerCase() === R.channel.toLowerCase())) m.channels.push(R.channel);
  if (m.qbAlloc && !m.qbAlloc[R.channel]) m.qbAlloc[R.channel] = 'upload';
  state._spqMemo = {}; state._mkpMemo = null; state._mklMemo = {};
  _mktgSave();
}
// The confirm card for a parsed statement (shown in the uploads area before Add).
function prvPendingCard(P, branches) {
  const R = P.provider; const muted = { color: 'var(--text-muted)' };
  const usd = (v) => (v < 0 ? '−' : '') + fmt.usd0(Math.abs(v));
  const yms = Object.keys(R.months).sort().filter(ym => R.months[ym].leads || R.months[ym].gross || R.months[ym].credits);
  const th = (t, r) => el('th', { class: 'px-2 py-1 text-[9px] uppercase tracking-wider font-semibold ' + (r ? 'text-right' : 'text-left'), style: muted }, t);
  const td = (t, r, st) => el('td', { class: 'px-2 py-1 tabular-nums ' + (r ? 'text-right' : ''), style: st || {} }, t);
  const rows = yms.slice(-6).map(ym => { const x = R.months[ym]; const placed = Object.keys(x.by).filter(b => branches.includes(b)).length;
    return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } }, td(reportingMonthLbl(ym), false, { fontWeight: '700' }), td(fmt.int(x.leads), true), td(usd(x.gross), true),
      td(R.kind === 'baton' ? fmt.int(x.sent) + ' · ' + usd(x.credits) : '—', true, muted), td(usd(x.net), true, { fontWeight: '800', color: x.net < 0 ? '#3E5A3A' : 'var(--text)' }),
      td(placed ? placed + ' branch' + (placed === 1 ? '' : 'es') + (x.unplacedLeads ? ' · ' + x.unplacedLeads + ' lead' + (x.unplacedLeads === 1 ? '' : 's') + ' outside RIDD markets' : '') : 'no branch split', false, muted)); });
  return el('div', { class: 'px-5 py-4 border-b flex flex-col gap-3', style: { borderColor: 'var(--border)' } },
    el('div', { class: 'flex items-center gap-2 flex-wrap text-[11px]' },
      el('span', { class: 'font-bold text-xs' }, P.fileName), el('span', { class: 'rounded-full px-2 py-0.5 text-[10px] font-bold', style: { background: 'rgba(95,108,91,.16)', color: '#5F6C5B' } }, '✓ ' + R.channel + ' statement'),
      el('span', { style: muted }, R.note)),
    el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
      el('thead', {}, el('tr', {}, th('Month'), th('Leads bought', true), th('Gross', true), th(R.kind === 'baton' ? 'Referrals sent · credit' : '', true), th('Net spend', true), th('Branches'))),
      el('tbody', {}, ...rows))),
    el('div', { class: 'flex items-center gap-2 text-[11px]' },
      el('span', { style: muted }, 'Adds every month on the statement; a month already loaded from an earlier ' + R.channel + ' statement is replaced.'),
      el('span', { class: 'ml-auto inline-flex gap-2' },
        el('button', { class: 'rounded-lg border px-2.5 py-1 font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._spendPending = state._spendPending.filter(x => x !== P); mountApp(); } }, 'Discard'),
        el('button', { class: 'rounded-lg px-3 py-1 font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)' }, onclick: () => { prvCommit(R, P.fileName, branches); state._spendPending = state._spendPending.filter(x => x !== P); toast(R.channel + ' statement added · ' + yms.length + ' month' + (yms.length === 1 ? '' : 's'), 'success'); mountApp(); } }, 'Add ' + R.channel))));
}
