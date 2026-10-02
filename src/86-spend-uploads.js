// ┌─ src/86-spend-uploads.js ────────────────────────────────────────────────
// │ Spend report uploads (per Isaac, Oct 2) — Reporting → Marketing → Spend
// │ entry. Drop any provider's spend report (CSV / Excel, one or many); pick
// │ the channel, the amount column, the date column (or one month for the
// │ whole file) and — when the report has one — the column that says WHERE
// │ the money went (office, market, campaign, ZIP…). Each location value is
// │ mapped to an office once and remembered; spend with no location is split
// │ across offices by that channel's leads for the month. The result lands
// │ in the same branch × channel sheet the controller books from
// │ (marketing.spend[ym][channel][BRANCH]). Uploads are kept as a list so one
// │ can be removed and the sheet recomputed.
// │ Part of the app.js bundle (tools/bundle.js concatenates src/*.js in name order).
// └────────────────────────────────────────────────────────────────────────
const SPU_SPLIT = '__split', SPU_SKIP = '__skip';
function _spuStore() {
  const m = _mktgStore();
  m.spendUploads = Array.isArray(m.spendUploads) ? m.spendUploads : [];   // [{ id, fileName, channel, at, by, total, n, cells: { ym: { BRANCH: amt } } }]
  m.spendLocMap = (m.spendLocMap && typeof m.spendLocMap === 'object') ? m.spendLocMap : {};   // { 'location value' (lowercase): BRANCH | SPU_SPLIT | SPU_SKIP }
  return m;
}
const _spuNum = (v) => { if (typeof v === 'number') return isFinite(v) ? v : 0; const s = String(v == null ? '' : v).trim(); if (!s) return 0; const neg = /^\(.*\)$/.test(s) || /^-/.test(s); const n = parseFloat(s.replace(/[^0-9.]/g, '')); return isFinite(n) ? (neg ? -n : n) : 0; };
const _spuKey = (v) => String(v == null ? '' : v).trim().toLowerCase();
function _spuGuessCols(headers, rows) {
  const pick = (res) => { for (const re of res) { const h = headers.find(x => re.test(String(x))); if (h) return h; } return ''; };
  const numeric = (h) => { let n = 0, k = 0; for (const r of rows.slice(0, 40)) { if (r[h] === '' || r[h] == null) continue; k++; if (_spuNum(r[h]) !== 0 || /^[\s$]*0/.test(String(r[h]))) n++; } return k > 0 && n / k >= 0.7; };
  let amount = '';
  for (const re of [/spend/i, /cost/i, /amount/i, /charge/i, /billed|invoice/i, /total/i, /price|fee/i]) { const h = headers.find(x => re.test(String(x)) && !/per|cpl|cpc|cpm|avg|rate|%/i.test(String(x)) && numeric(x)); if (h) { amount = h; break; } }
  return { amount, date: pick([/^date$/i, /date|day/i, /month|period/i, /created|time/i]), loc: pick([/office|branch/i, /location|market|territory|region/i, /campaign/i, /account/i, /city/i, /zip|postal/i, /state/i]) };
}
// A location value → office: remembered choice, else an office name inside the
// value ("FB | Detroit | RPS" → DETROIT), else a ZIP's office, else split.
function _spuAutoOffice(val, branches, m) {
  const k = _spuKey(val); if (!k) return SPU_SPLIT;
  if (m.spendLocMap[k]) return m.spendLocMap[k];
  const flat = k.replace(/[^a-z0-9]/g, '');
  let best = '';
  for (const b of branches) { const bk = String(b).toLowerCase().replace(/[^a-z0-9]/g, ''); if (bk.length >= 3 && flat.includes(bk) && bk.length > best.replace(/[^a-z0-9]/gi, '').length) best = b; }
  if (best) return best;
  const z = /^\D*(\d{5})(?:-\d{4})?\D*$/.exec(String(val));
  if (z && typeof _ghlZipOffice === 'function') { const o = _ghlZipOffice().get(z[1]); if (o && branches.includes(o)) return o; }
  return SPU_SPLIT;
}
// Office weights for one channel-month: that channel's GoHighLevel leads by
// office, else its FieldRoutes sales, else all new sales.
function _spuWeights(channel, ym, branches) {
  const ok = new Set(branches), w = {}; let how = '';
  const G = (typeof ghlLeads === 'function') ? ghlLeads() : null;
  if (G && G.leads) for (const l of G.leads) if (l.prov === channel && l.office && ok.has(l.office) && String(l.d).slice(0, 7) === ym) w[l.office] = (w[l.office] || 0) + 1;
  if (Object.keys(w).length) how = 'leads';
  else {
    const subs = state.reportingSubscriptions || [], all = {};
    for (const r of subs) {
      if (String(r.sold_date || '').slice(0, 7) !== ym) continue;
      const o = String(r.office_name || '').toUpperCase(); if (!ok.has(o)) continue;
      const src = reportingSourceOf(r);
      if (typeof reportingSourceClass === 'function' && reportingSourceClass(src) !== 'new') continue;
      all[o] = (all[o] || 0) + 1;
      if (src === channel || (typeof reportingProviderOf === 'function' && reportingProviderOf(src) === channel)) w[o] = (w[o] || 0) + 1;
    }
    if (Object.keys(w).length) how = 'sales'; else if (Object.keys(all).length) { Object.assign(w, all); how = 'all sales'; }
  }
  return { w, how };
}
function _spuSplit(amount, w) {
  const ks = Object.keys(w), tot = ks.reduce((t, k) => t + w[k], 0); if (!tot) return null;
  const out = {}; let used = 0, big = ks[0];
  for (const k of ks) { out[k] = Math.round(amount * w[k] / tot * 100) / 100; used += out[k]; if (w[k] > w[big]) big = k; }
  out[big] = Math.round((out[big] + amount - used) * 100) / 100;
  return out;
}
// Turn one pending file into { cells, total, months, unalloc, skipped, locs }.
function _spuCompute(P, branches, m) {
  const cells = {}, raw = {};   // raw[ym] = { located: {B: amt}, split: amt }
  const locs = new Map();       // location value → { amt, n }
  let skipped = 0, noDate = 0, n = 0;
  for (const r of P.rows) {
    const amt = _spuNum(r[P.cols.amount]); if (!amt) continue;
    const first = String(r[P.headers[0]] == null ? '' : r[P.headers[0]]);
    if (/^\s*(grand\s+)?totals?\b/i.test(first)) continue;   // a totals row would double the file
    let ym = P.cols.date ? String(_attrDate(r[P.cols.date]) || '').slice(0, 7) : '';
    if (!ym) { if (P.month) ym = P.month; else { noDate += amt; continue; } }
    n++;
    const R = raw[ym] = raw[ym] || { located: {}, split: 0 };
    if (!P.cols.loc) { const d = P.noLoc || SPU_SPLIT; if (d === SPU_SPLIT) R.split += amt; else R.located[d] = (R.located[d] || 0) + amt; continue; }
    const val = String(r[P.cols.loc] == null ? '' : r[P.cols.loc]).trim();
    const L = locs.get(val) || { amt: 0, n: 0 }; L.amt += amt; L.n++; locs.set(val, L);
    const to = (P.locMap && P.locMap[_spuKey(val)]) || _spuAutoOffice(val, branches, m);
    if (to === SPU_SKIP) skipped += amt; else if (to === SPU_SPLIT) R.split += amt; else R.located[to] = (R.located[to] || 0) + amt;
  }
  let total = 0, unalloc = 0; const hows = new Set();
  for (const ym of Object.keys(raw)) {
    const c = cells[ym] = Object.assign({}, raw[ym].located);
    if (raw[ym].split) {
      const W = _spuWeights(P.channel, ym, branches), parts = _spuSplit(raw[ym].split, W.w);
      if (parts) { hows.add(W.how); for (const b in parts) c[b] = (c[b] || 0) + parts[b]; } else unalloc += raw[ym].split;
    }
    for (const b in c) { c[b] = Math.round(c[b] * 100) / 100; total += c[b]; }
    if (!Object.keys(c).length) delete cells[ym];
  }
  return { cells, total: Math.round(total * 100) / 100, months: Object.keys(cells).sort(), unalloc, skipped, noDate, locs, n, hows: [...hows] };
}
// Rebuild the controller sheet for one channel's months from every upload of that channel.
function _spuRebuild(m, channel, yms) {
  for (const ym of yms) {
    const sum = {};
    for (const u of m.spendUploads) if (u.channel === channel && u.cells && u.cells[ym]) for (const b in u.cells[ym]) sum[b] = Math.round(((sum[b] || 0) + Number(u.cells[ym][b] || 0)) * 100) / 100;
    m.spend[ym] = m.spend[ym] || {};
    if (Object.keys(sum).length) m.spend[ym][channel] = sum; else delete m.spend[ym][channel];
  }
}
async function _spuUpload(files) {
  const list = Array.from(files || []); if (!list.length) return;
  try { await loadXlsxLibOnce(); } catch { toast('Could not load Excel library — check your connection', 'error'); return; }
  const m = _spuStore();
  state._spendPending = state._spendPending || [];
  for (const file of list) {
    try {
      const wb = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: false });
      let any = false;
      for (const sheet of wb.SheetNames) {
        const rows = XLSX.utils.sheet_to_json(wb.Sheets[sheet], { defval: '', raw: true });
        if (!rows.length) continue;
        const headers = Object.keys(rows[0]);
        const cols = _spuGuessCols(headers, rows);
        if (!cols.amount && wb.SheetNames.length > 1) continue;   // a tab with no money column in a multi-tab workbook is not a spend sheet
        any = true;
        state._spendPending.push({ key: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), fileName: wb.SheetNames.length > 1 ? file.name + ' · ' + sheet : file.name,
          headers, rows, cols, channel: _attrGuessProvider(file.name + ' ' + sheet, m.channels) || '', month: state._mktEntryMonth || '', noLoc: SPU_SPLIT, locMap: {} });
      }
      if (!any) toast('No spend rows found in ' + file.name, 'error');
    } catch (e) { toast('Could not read ' + file.name + ': ' + (e.message || e), 'error'); }
  }
  mountApp();
}
function _spuCommit(P, branches) {
  const m = _spuStore();
  const C = _spuCompute(P, branches, m);
  if (!P.channel) { toast('Pick the channel for ' + P.fileName, 'error'); return; }
  if (!C.months.length) { toast('Nothing to add — check the amount and date columns', 'error'); return; }
  for (const k in (P.locMap || {})) m.spendLocMap[k] = P.locMap[k];   // remember the office picks
  m.spendUploads.push({ id: P.key, fileName: P.fileName, channel: P.channel, at: new Date().toISOString(), by: (state.profile && state.profile.full_name) || '', total: C.total, n: C.n, cells: C.cells });
  _spuRebuild(m, P.channel, C.months);
  state._spendPending = (state._spendPending || []).filter(x => x !== P);
  _mktgSave();
  toast('Added ' + fmt.usd0(C.total) + ' of ' + P.channel + ' spend across ' + C.months.length + ' month' + (C.months.length === 1 ? '' : 's'), 'success');
  mountApp();
}
function _spuRemove(id) {
  const m = _spuStore();
  const u = m.spendUploads.find(x => x.id === id); if (!u) return;
  m.spendUploads = m.spendUploads.filter(x => x.id !== id);
  _spuRebuild(m, u.channel, Object.keys(u.cells || {}));
  _mktgSave(); toast('Removed ' + u.fileName, 'success'); mountApp();
}
// The card at the top of Spend entry.
function mktgSpendUploadCard(B, year) {
  const m = _spuStore(), branches = B.all;
  const muted = { color: 'var(--text-muted)' };
  const selCls = 'rounded-lg border px-2 py-1 text-[11px]';
  const selSt = { borderColor: 'var(--border-2)', background: 'var(--card)', color: 'var(--text)', maxWidth: '220px' };
  const sel = (val, opts, on) => el('select', { class: selCls, style: selSt, onchange: (e) => { on(e.target.value); mountApp(); } }, ...opts.map(([v, t]) => el('option', { value: v, selected: v === val }, t)));
  const officeOpts = [[SPU_SPLIT, 'Split by leads'], ...branches.map(b => [b, _mktgTC(b)]), [SPU_SKIP, 'Skip (not spend)']];
  const fileIn = el('input', { type: 'file', multiple: true, accept: '.csv,.xlsx,.xls,.tsv', class: 'hidden', onchange: (e) => { _spuUpload(e.target.files); e.target.value = ''; } });
  const head = el('div', { class: 'px-5 py-3 border-b flex items-center gap-3 flex-wrap', style: { borderColor: 'var(--border)' } },
    el('div', {}, el('h3', { class: 'text-sm font-bold' }, 'Upload spend reports'),
      el('div', { class: 'text-[11px] mt-0.5', style: muted }, 'Drop any provider’s spend report (CSV or Excel, one or many). Pick the channel and columns, map locations to offices once, and it fills the allocation sheet below.')),
    el('label', { class: 'ml-auto rounded-lg px-3 py-1.5 text-[11px] font-bold cursor-pointer', style: { background: 'var(--accent)', color: 'var(--accent-text)' } }, '↑ Choose files', fileIn));
  const pending = (state._spendPending || []).map(P => {
    const C = _spuCompute(P, branches, m);
    const colOpts = (none) => [['', none], ...P.headers.map(h => [h, h])];
    const overlap = m.spendUploads.filter(u => u.channel === P.channel && C.months.some(ym => u.cells && u.cells[ym]));
    const locRows = P.cols.loc ? [...C.locs.entries()].sort((a, b) => b[1].amt - a[1].amt) : [];
    const shownLocs = locRows.slice(0, 80);
    return el('div', { class: 'px-5 py-4 border-b flex flex-col gap-3', style: { borderColor: 'var(--border)' } },
      el('div', { class: 'flex items-center gap-2 flex-wrap text-[11px]' },
        el('span', { class: 'font-bold text-xs' }, P.fileName), el('span', { style: muted }, P.rows.length.toLocaleString() + ' rows')),
      el('div', { class: 'flex items-center gap-3 flex-wrap text-[11px]' },
        el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Channel'), sel(P.channel, [['', 'Pick a channel…'], ...m.channels.map(c => [c, c])], (v) => { P.channel = v; })),
        el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Amount'), sel(P.cols.amount, colOpts('Pick a column…'), (v) => { P.cols.amount = v; })),
        el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Date'), sel(P.cols.date, colOpts('No date column'), (v) => { P.cols.date = v; })),
        (!P.cols.date || C.noDate) ? el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, P.cols.date ? 'Rows with no date go to' : 'Month'),
          sel(P.month, [['', 'Pick a month…'], ...[year - 1, year].flatMap(y => MKTG_MONTHS.map((mn, i) => [_mktgYm(y, i), mn + ' ' + y]))], (v) => { P.month = v; })) : null,
        el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Location'), sel(P.cols.loc, colOpts('No location column'), (v) => { P.cols.loc = v; P.locMap = {}; })),
        !P.cols.loc ? el('label', { class: 'inline-flex items-center gap-1.5' }, el('span', { class: 'font-semibold' }, 'Goes to'), sel(P.noLoc, officeOpts.filter(o => o[0] !== SPU_SKIP), (v) => { P.noLoc = v; })) : null),
      locRows.length ? el('div', { class: 'flex flex-col gap-1' },
        el('div', { class: 'text-[10px] uppercase tracking-widest font-semibold', style: muted }, 'Location → office (' + locRows.length + ') · remembered for next time'),
        el('div', { class: 'grid gap-x-4 gap-y-1', style: { gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' } },
          ...shownLocs.map(([val, L]) => {
            const k = _spuKey(val), cur = (P.locMap && P.locMap[k]) || _spuAutoOffice(val, branches, m);
            return el('div', { class: 'flex items-center gap-2 text-[11px]' },
              el('span', { class: 'truncate', style: { flex: '1', minWidth: '0' }, title: val }, val || '(blank)'),
              el('span', { class: 'tabular-nums', style: muted }, fmt.usd0(L.amt)),
              sel(cur, officeOpts, (v) => { P.locMap = P.locMap || {}; P.locMap[k] = v; }));
          })),
        locRows.length > shownLocs.length ? el('div', { class: 'text-[11px]', style: muted }, '+ ' + (locRows.length - shownLocs.length) + ' smaller locations mapped automatically (office name or ZIP in the value, else split by leads).') : null) : null,
      el('div', { class: 'flex items-center gap-3 flex-wrap text-[11px]' },
        el('span', { class: 'font-semibold' }, C.months.length ? fmt.usd0(C.total) + ' · ' + C.months.map(reportingMonthLbl).join(', ') : 'Nothing to add yet'),
        C.months.length ? el('span', { style: muted }, Object.entries(C.months.reduce((o, ym) => { for (const b in C.cells[ym]) o[b] = (o[b] || 0) + C.cells[ym][b]; return o; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([b, v]) => _mktgTC(b) + ' ' + fmt.usd0(v)).join(' · ')) : null,
        C.hows.length ? el('span', { style: muted }, 'split by ' + C.hows.join(' / ')) : null,
        C.unalloc ? el('span', { style: { color: '#DC2626', fontWeight: '600' } }, fmt.usd0(C.unalloc) + ' could not be split (no leads or sales that month) — pick an office') : null,
        (C.noDate && !P.month) ? el('span', { style: { color: '#DC2626', fontWeight: '600' } }, fmt.usd0(C.noDate) + ' has no date — pick a month') : null,
        C.skipped ? el('span', { style: muted }, fmt.usd0(C.skipped) + ' skipped') : null,
        overlap.length ? el('span', { style: { color: '#B45309', fontWeight: '600' } }, 'Already have ' + overlap.length + ' ' + P.channel + ' upload' + (overlap.length === 1 ? '' : 's') + ' for these months — this ADDS to them. Remove the old one below if this replaces it.') : null,
        el('span', { class: 'ml-auto inline-flex gap-2' },
          el('button', { class: 'rounded-lg border px-2.5 py-1 font-semibold', style: { borderColor: 'var(--border-2)' }, onclick: () => { state._spendPending = state._spendPending.filter(x => x !== P); mountApp(); } }, 'Discard'),
          el('button', { class: 'rounded-lg px-3 py-1 font-bold', style: { background: 'var(--accent)', color: 'var(--accent-text)', opacity: (P.channel && C.months.length && !C.unalloc) ? '1' : '.5' }, onclick: () => { if (C.unalloc) { toast('Pick an office for the spend that could not be split', 'error'); return; } _spuCommit(P, branches); } }, 'Add to allocation'))));
  });
  const ups = m.spendUploads.slice().sort((a, b) => String(b.at).localeCompare(String(a.at)));
  const list = ups.length ? el('div', { class: 'scroll-x' }, el('table', { class: 'w-full text-[11px]' },
    el('thead', {}, el('tr', {}, ...['Report', 'Channel', 'Months', 'Spend', 'Offices', 'Added', ''].map(h => el('th', { class: 'px-3 py-1.5 text-left text-[9px] uppercase tracking-wider font-semibold whitespace-nowrap', style: muted }, h)))),
    el('tbody', {}, ...ups.map(u => {
      const yms = Object.keys(u.cells || {}).sort(), offs = new Set(); for (const ym of yms) for (const b in u.cells[ym]) offs.add(b);
      return el('tr', { class: 'border-t', style: { borderColor: 'var(--border)' } },
        el('td', { class: 'px-3 py-1.5' }, u.fileName), el('td', { class: 'px-3 py-1.5 font-semibold whitespace-nowrap' }, u.channel),
        el('td', { class: 'px-3 py-1.5 whitespace-nowrap' }, yms.length > 2 ? reportingMonthLbl(yms[0]) + ' – ' + reportingMonthLbl(yms[yms.length - 1]) : yms.map(reportingMonthLbl).join(', ')),
        el('td', { class: 'px-3 py-1.5 tabular-nums font-semibold' }, fmt.usd0(u.total)), el('td', { class: 'px-3 py-1.5 tabular-nums' }, String(offs.size)),
        el('td', { class: 'px-3 py-1.5 whitespace-nowrap', style: muted }, new Date(u.at).toLocaleDateString([], { month: 'short', day: 'numeric' }) + (u.by ? ' · ' + u.by : '')),
        el('td', { class: 'px-3 py-1.5 text-right' }, el('button', { class: 'underline', style: { color: '#DC2626', minHeight: '24px' }, title: 'Remove this report and take its spend back out of the sheet', onclick: () => _spuRemove(u.id) }, 'Remove')));
    })))) : null;
  return el('div', { class: 'card overflow-hidden' }, head, ...pending, list,
    el('div', { class: 'px-5 py-2 text-[11px]', style: muted }, 'A channel-month covered by uploaded reports is set from the reports (it replaces numbers typed into the sheet for that channel and month).'));
}
